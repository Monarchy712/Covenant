// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CovenantBase} from "./CovenantBase.t.sol";
import {CovenantVault} from "../../src/covenant/CovenantVault.sol";

/// @notice Suite 5 — net-sell governor: below/exact/above cap, bid fills restore allowance,
///         window roll (poke + lazy), and the quantified boundary drift bound.
contract GovernorTest is CovenantBase {
    function setUp() public {
        _setupActive();
    }

    // Cap = 1000 base. resting-ask exposure counts toward the cap.
    function test_below_exact_above_cap() public {
        _quoteTwoSided(); // 1 bid + 1 ask of 100 base => restingAsk = 100
        // add 900 more ask base (total 1000) => exactly at cap: OK
        vm.prank(mm);
        vault.quote(_empty32(), _empty96(), _u32(ASK_PX), _u96(900e10), _empty40());
        assertEq(vault.restingAskBaseRaw(), 1000e18, "resting == cap");

        // one more base => over cap: revert
        vm.prank(mm);
        vm.expectRevert();
        vault.quote(_empty32(), _empty96(), _u32(ASK_PX), _u96(1e10), _empty40());
    }

    function test_bidFill_restoresAllowance() public {
        _quoteTwoSided(); // bid 100, ask 100
        _takerBuy(50); // sells 50 base off the ask => soldBase ~ +50
        vault.poke();
        int256 soldAfterSell = vault.soldBaseSigned();
        assertGt(soldAfterSell, int256(0), "net sold positive");

        // taker sells 40 base INTO the vault's bid => vault buys back => soldBase drops
        _takerSell(40);
        vault.poke();
        int256 soldAfterBuyback = vault.soldBaseSigned();
        assertLt(soldAfterBuyback, soldAfterSell, "buyback reduced net sold (allowance restored)");
    }

    function test_windowRoll_viaPoke_resetsNetSold() public {
        _quoteTwoSided();
        _takerBuy(100); // net sold ~ +100 in window 0
        int256 netW0 = vault.netSoldInWindow();
        assertGt(netW0, int256(0));

        // advance a full window and poke
        vm.warp(block.timestamp + WINDOW + 1);
        vault.poke();
        assertEq(vault.currentWindowIndex(), 1, "rolled to window 1");
        // netSoldInWindow snapshots to ~0 at the new window start
        assertApproxEqAbs(vault.netSoldInWindow(), int256(0), 1, "net sold reset for new window");
    }

    function test_windowRoll_lazyOnQuote() public {
        _quoteTwoSided();
        _takerBuy(100);
        vm.warp(block.timestamp + WINDOW + 1);
        // no explicit poke; a quote triggers the lazy roll
        vm.prank(mm);
        vault.quote(_empty32(), _empty96(), _u32(ASK_PX), _u96(10e10), _empty40());
        assertEq(vault.currentWindowIndex(), 1, "lazy roll on quote");
    }

    /// @notice DRIFT BOUND: fills between the window boundary and the first poke are attributed
    ///         to the PREVIOUS window. Here a taker fills right after the boundary but before
    ///         poke; after poke the NEW window's net sold is ~0 (the fill counted in window 0).
    ///         Bound: drift <= base fillable in that gap (<= resting ask depth at the boundary).
    function test_driftBound_fillBeforePoke_attributedToPrevWindow() public {
        _quoteTwoSided(); // ask depth 100 base
        // cross the boundary
        vm.warp(block.timestamp + WINDOW + 1);
        // taker fills 30 base AFTER the boundary but BEFORE anyone pokes
        _takerBuy(30);
        // now poke: soldAtWindowStart snapshots CURRENT soldBase (which already includes the 30)
        vault.poke();
        assertEq(vault.currentWindowIndex(), 1);
        // new window net sold starts ~0 => the 30-base fill was attributed to window 0 (the drift).
        assertApproxEqAbs(vault.netSoldInWindow(), int256(0), 1e15, "post-poke new window ~0 (drift <= filled depth)");
    }
}
