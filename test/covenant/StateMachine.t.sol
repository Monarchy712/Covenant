// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CovenantBase} from "./CovenantBase.t.sol";
import {CovenantFactory} from "../../src/covenant/CovenantFactory.sol";
import {CovenantVault} from "../../src/covenant/CovenantVault.sol";
import {Terms, State} from "../../src/covenant/CovenantTypes.sol";

/// @notice Suite 2 — State machine: transitions valid where allowed, WrongState otherwise.
contract StateMachineTest is CovenantBase {
    function _freshCreated() internal returns (CovenantVault v) {
        _fork();
        _deployMarket();
        factory = new CovenantFactory(MARGIN);
        v = _createMandate(_defaultTerms());
        base.mint(issuer, 1_000_000e18);
        quote.mint(issuer, 1_000_000e6);
    }

    function test_created_cannotActivateOrQuote() public {
        CovenantVault v = _freshCreated();
        vm.prank(issuer);
        vm.expectRevert(); // ACCEPTED required
        v.activate();
        vm.prank(mm);
        vm.expectRevert();
        v.quote(_u32(BID_PX), _u96(QTY), _u32(ASK_PX), _u96(QTY), _empty40());
    }

    function test_accept_onlyFromCreated() public {
        CovenantVault v = _freshCreated();
        vm.prank(mm);
        v.accept();
        assertEq(uint256(v.currentState()), uint256(State.ACCEPTED));
        vm.prank(mm);
        vm.expectRevert(abi.encodeWithSelector(CovenantVault.WrongState.selector, State.ACCEPTED));
        v.accept();
    }

    function test_activate_requiresInventoryAndEscrow() public {
        CovenantVault v = _freshCreated();
        vm.prank(mm);
        v.accept();
        // no inventory yet
        vm.prank(issuer);
        vm.expectRevert(CovenantVault.NotActivatable.selector);
        v.activate();
        // deposit but no fee escrow
        vm.startPrank(issuer);
        base.approve(address(v), 100e18);
        v.depositInventory(address(base), 100e18);
        vm.expectRevert(CovenantVault.NotActivatable.selector);
        v.activate();
        // fund fees -> activate ok
        quote.approve(address(v), 100e6);
        v.fundFees(FEE_PER);
        v.activate();
        vm.stopPrank();
        assertEq(uint256(v.currentState()), uint256(State.ACTIVE));
    }

    function test_updateTerms_lockedAfterAccept() public {
        CovenantVault v = _freshCreated();
        Terms memory t = _defaultTerms();
        t.issuer = issuer;
        t.bandBps = 300;
        vm.prank(issuer);
        v.updateTerms(t); // allowed in CREATED
        vm.prank(mm);
        v.accept();
        vm.prank(issuer);
        vm.expectRevert(CovenantVault.TermsLocked.selector);
        v.updateTerms(t);
    }

    function test_pause_unpause_onlyActive() public {
        _setupActive();
        vm.prank(issuer);
        vault.pause();
        assertEq(uint256(vault.currentState()), uint256(State.PAUSED));
        // cannot pause again
        vm.prank(issuer);
        vm.expectRevert();
        vault.pause();
        // quoting blocked while paused
        vm.prank(mm);
        vm.expectRevert();
        vault.quote(_u32(BID_PX), _u96(QTY), _u32(ASK_PX), _u96(QTY), _empty40());
        // cancel allowed while paused
        vm.prank(mm);
        vault.cancel(_empty40());
        vm.prank(issuer);
        vault.unpause();
        assertEq(uint256(vault.currentState()), uint256(State.ACTIVE));
    }

    function test_endedLazily_byDuration_blocksQuote() public {
        _setupActive();
        vm.warp(block.timestamp + DURATION + 1);
        assertEq(uint256(vault.currentState()), uint256(State.ENDED), "lazy ended");
        vm.prank(mm);
        vm.expectRevert();
        vault.quote(_u32(BID_PX), _u96(QTY), _u32(ASK_PX), _u96(QTY), _empty40());
    }

    function test_withdraw_requiresEndedAndNoOpenOrders() public {
        _setupActive();
        _quoteTwoSided();
        // not ended yet
        vm.prank(issuer);
        vm.expectRevert();
        vault.withdraw();
        // terminate -> ended, but open orders remain
        vm.prank(issuer);
        vault.terminate();
        vm.prank(issuer);
        vm.expectRevert(CovenantVault.OpenOrdersRemain.selector);
        vault.withdraw();
        // cancel then withdraw
        vault.cancelAllAfterEnd();
        vm.prank(issuer);
        vault.withdraw();
        assertEq(uint256(vault.currentState()), uint256(State.SETTLED));
    }
}
