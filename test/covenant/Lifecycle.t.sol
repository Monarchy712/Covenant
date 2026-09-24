// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CovenantBase} from "./CovenantBase.t.sol";
import {State} from "../../src/covenant/CovenantTypes.sol";
import {CovenantVault} from "../../src/covenant/CovenantVault.sol";

/// @notice Suite 8 — end-to-end lifecycle with balance assertions.
contract LifecycleTest is CovenantBase {
    function test_fullLifecycle() public {
        _setupActive();
        assertEq(uint256(vault.currentState()), uint256(State.ACTIVE), "active");
        assertEq(margin.getBalance(address(vault), address(base)), 5_000e18, "base margin");
        assertEq(margin.getBalance(address(vault), address(quote)), 5_000e6, "quote margin");

        // MM quotes two-sided
        _quoteTwoSided();
        assertEq(vault.openBidCount(), 1);
        assertEq(vault.openAskCount(), 1);

        // taker fills 40 base off the ask
        _takerBuy(40);
        vault.poke();
        assertGt(uint256(vault.soldBaseSigned()), 0, "sold positive after ask fill");

        // a passing checkpoint accrues a fee
        vm.warp(block.timestamp + 1);
        vault.checkpoint();
        // roll to next interval to finalize interval 0
        vm.warp(block.timestamp + CHECKPOINT);
        vault.checkpoint();
        assertEq(vault.accruedFees(), FEE_PER, "one interval paid");

        // pause / unpause
        vm.prank(issuer);
        vault.pause();
        assertEq(uint256(vault.currentState()), uint256(State.PAUSED));
        vm.prank(issuer);
        vault.unpause();

        // MM claims fees
        uint256 mmQuoteBefore = quote.balanceOf(mm);
        vm.prank(mm);
        vault.claimFees();
        assertEq(quote.balanceOf(mm) - mmQuoteBefore, FEE_PER, "mm claimed one fee");

        // end via terminate, cancel remaining orders, withdraw, settle
        vm.prank(issuer);
        vault.terminate();
        assertEq(uint256(vault.currentState()), uint256(State.ENDED));

        vault.cancelAllAfterEnd();
        assertEq(vault.openBidCount(), 0);
        assertEq(vault.openAskCount(), 0);

        uint256 issuerBaseBefore = base.balanceOf(issuer);
        uint256 issuerQuoteBefore = quote.balanceOf(issuer);
        vm.prank(issuer);
        vault.withdraw();
        assertEq(uint256(vault.currentState()), uint256(State.SETTLED), "settled");

        // vault holds zero margin after settle
        assertEq(margin.getBalance(address(vault), address(base)), 0, "base margin drained");
        assertEq(margin.getBalance(address(vault), address(quote)), 0, "quote margin drained");
        // issuer got base + quote proceeds back
        assertGt(base.balanceOf(issuer), issuerBaseBefore, "issuer got base");
        assertGt(quote.balanceOf(issuer), issuerQuoteBefore, "issuer got quote");
        // vault retains only the MM's already-claimed-safe accrued-unclaimed (0 here) + nothing
        assertEq(
            quote.balanceOf(address(vault)), vault.accruedFees() - vault.claimedFees(), "only unclaimed fees remain"
        );
    }
}
