// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CovenantBase} from "./CovenantBase.t.sol";
import {CovenantFactory} from "../../src/covenant/CovenantFactory.sol";
import {CovenantVault} from "../../src/covenant/CovenantVault.sol";
import {Terms} from "../../src/covenant/CovenantTypes.sol";

/// @notice Suite 7 — fees: accrual, claim, escrow cap, exhaustion, unused escrow returned.
contract FeesTest is CovenantBase {
    function _accrueOnePassingInterval() internal {
        _quoteTwoSided();
        vm.warp(block.timestamp + 1);
        vault.checkpoint();
        vm.warp(block.timestamp + CHECKPOINT);
        vault.checkpoint(); // finalize the passing interval
    }

    function test_accrueAndClaim() public {
        _setupActive();
        _accrueOnePassingInterval();
        assertEq(vault.accruedFees(), FEE_PER);
        uint256 before = quote.balanceOf(mm);
        vm.prank(mm);
        vault.claimFees();
        assertEq(quote.balanceOf(mm) - before, FEE_PER);
        assertEq(vault.claimedFees(), FEE_PER);
        // nothing left to claim
        vm.prank(mm);
        vm.expectRevert(CovenantVault.NothingToClaim.selector);
        vault.claimFees();
    }

    function test_accruedNeverExceedsEscrow() public {
        // Fund escrow with exactly ONE fee, then earn TWO passing intervals.
        _fork();
        _deployMarket();
        factory = new CovenantFactory(MARGIN);
        vault = _createMandate(_defaultTerms());
        base.mint(issuer, 1_000_000e18);
        quote.mint(issuer, 1_000_000e6);
        vm.prank(mm);
        vault.accept();
        vm.startPrank(issuer);
        base.approve(address(vault), 10_000e18);
        quote.approve(address(vault), 10_000e6);
        vault.depositInventory(address(base), 5_000e18);
        vault.depositInventory(address(quote), 5_000e6); // quote margin for bids
        vault.fundFees(FEE_PER); // only ONE fee of escrow (separate from margin)
        vault.activate();
        vm.stopPrank();

        _quoteTwoSided();
        // interval 0 pass
        vm.warp(block.timestamp + 1);
        vault.checkpoint();
        // interval 1 pass (finalizes 0)
        vm.warp(block.timestamp + CHECKPOINT);
        vault.checkpoint();
        // interval 2 (finalizes 1) — but escrow only covers one fee
        vm.warp(block.timestamp + CHECKPOINT);
        vault.checkpoint();
        assertLe(vault.accruedFees(), vault.feeEscrow(), "accrued never exceeds escrow");
        assertEq(vault.accruedFees(), FEE_PER, "capped at the single funded fee");
    }

    function test_unusedEscrowReturnedOnWithdraw() public {
        _setupActive(); // escrow 1000 USDC
        _accrueOnePassingInterval(); // earn 50
        // MM claims the 50
        vm.prank(mm);
        vault.claimFees();

        vm.prank(issuer);
        vault.terminate();
        vault.cancelAllAfterEnd();

        uint256 issuerQuoteBefore = quote.balanceOf(issuer);
        vm.prank(issuer);
        vault.withdraw();
        // issuer gets back quote proceeds + unused escrow (escrow 1000 - accrued 50 = 950)
        // (plus any quote margin proceeds); assert at least the unused escrow returned.
        assertGe(quote.balanceOf(issuer) - issuerQuoteBefore, 950e6, "unused escrow (>=950) returned");
        // vault retains only accrued-unclaimed (0 here)
        assertEq(quote.balanceOf(address(vault)), vault.accruedFees() - vault.claimedFees());
    }
}
