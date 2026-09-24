// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CovenantBase} from "./CovenantBase.t.sol";
import {CovenantVault} from "../../src/covenant/CovenantVault.sol";

/// @notice Suite 3 — Roles: issuer-only, MM-only, anyone paths; attacker locked out.
contract RolesTest is CovenantBase {
    function setUp() public {
        _setupActive();
    }

    function test_attacker_cannotDoIssuerActions() public {
        vm.startPrank(attacker);
        vm.expectRevert(CovenantVault.NotIssuer.selector);
        vault.depositInventory(address(base), 1e18);
        vm.expectRevert(CovenantVault.NotIssuer.selector);
        vault.fundFees(1e6);
        vm.expectRevert(CovenantVault.NotIssuer.selector);
        vault.pause();
        vm.expectRevert(CovenantVault.NotIssuer.selector);
        vault.terminate();
        vm.expectRevert(CovenantVault.NotIssuer.selector);
        vault.withdraw();
        vm.stopPrank();
    }

    function test_attacker_cannotDoMMActions() public {
        vm.startPrank(attacker);
        vm.expectRevert(CovenantVault.NotMM.selector);
        vault.quote(_u32(BID_PX), _u96(QTY), _u32(ASK_PX), _u96(QTY), _empty40());
        vm.expectRevert(CovenantVault.NotMM.selector);
        vault.cancel(_u40(1));
        vm.expectRevert(CovenantVault.NotMM.selector);
        vault.claimFees();
        vm.stopPrank();
    }

    function test_issuer_cannotQuote() public {
        vm.prank(issuer);
        vm.expectRevert(CovenantVault.NotMM.selector);
        vault.quote(_u32(BID_PX), _u96(QTY), _u32(ASK_PX), _u96(QTY), _empty40());
    }

    function test_mm_cannotDoIssuerActions() public {
        vm.startPrank(mm);
        vm.expectRevert(CovenantVault.NotIssuer.selector);
        vault.pause();
        vm.expectRevert(CovenantVault.NotIssuer.selector);
        vault.withdraw();
        vm.stopPrank();
    }

    function test_anyone_canCheckpointAndPoke() public {
        _quoteTwoSided();
        vm.warp(block.timestamp + 1);
        vm.prank(attacker); // permissionless
        vault.checkpoint();
        vm.prank(attacker);
        vault.poke();
    }
}
