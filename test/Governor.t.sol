// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {KuruIntegrationSpike} from "../src/KuruIntegrationSpike.sol";

/// @notice PHASE 5 — minimal sell governor.
///   Rule: sold + resting + newAsk > allowance  => revert SellAllowanceExceeded.
///   `sold` comes from the Phase-4 on-chain formula (net disposed), not internal bookkeeping.
///   Required boundary cases (allowance 1,000 base): sold 900 + resting 50 + new 40 => ok;
///   new 50 => ok (exactly at limit); new 60 => revert.
contract GovernorTest is Base {
    uint32 constant ASK_PRICE = 2e8;

    function setUp() public {
        // allowance = 1000 base, band off.
        _standardSetup(1_000e18, 0);
        vm.startPrank(issuer);
        base.approve(address(vault), 5_000e18);
        vault.depositInventory(address(base), 5_000e18); // plenty of margin
        vm.stopPrank();
        quote.mint(taker, 100_000_000e6);
    }

    /// @dev Drive the on-chain `sold` measure to ~`targetWhole` base by posting an ask and
    ///      having the taker sweep it, then cancelling the remainder so `resting` returns to 0.
    function _sell(uint256 targetWhole) internal {
        // account for maker rebate: to net `target`, gross-match slightly more.
        vm.prank(mm);
        uint40 id = vault.placeAsk(ASK_PRICE, uint96((targetWhole + 5) * 1e10));
        vm.startPrank(taker);
        quote.approve(market, type(uint256).max);
        ob.placeAndExecuteMarketBuy(uint96(targetWhole * ASK_PRICE), 0, false, false);
        vm.stopPrank();
        vm.prank(mm);
        vault.cancelOrder(id); // free the unsold remainder; sold persists
    }

    function test_boundaries() public {
        // Establish sold ~= 900 base.
        _sell(900);
        uint256 sold = vault.soldBase();
        assertApproxEqAbs(sold, 900e18, 1e18, "sold ~= 900");

        // Add a resting ask of 50 base (resting = 50).
        vm.prank(mm);
        vault.placeAsk(ASK_PRICE, 50e10);
        assertEq(vault.restingAskBaseRaw(), 50e18, "resting == 50");

        // new 40 => sold(900)+resting(50)+40 = 990 <= 1000 => OK
        vm.prank(mm);
        vault.placeAsk(ASK_PRICE, 40e10);

        // reset resting to exactly 50 for the next sub-cases: cancel the 40 just placed.
        // (openAskIds order: [50-ask, 40-ask]; cancel the last one via its id)
        // simpler: read current sold and resting and test the exact-limit + over-limit news.
        uint256 sold2 = vault.soldBase();
        uint256 resting2 = vault.restingAskBaseRaw(); // 50 + 40 = 90
        emit log_named_uint("sold", sold2);
        emit log_named_uint("resting", resting2);

        // Now: remaining headroom = 1000 - sold - resting. A new ask at exactly headroom => OK,
        // headroom + 1 tick => revert. This is the "exactly at limit" and "over limit" pair.
        uint256 headroomBase = 1_000e18 - sold2 - resting2; // in raw base
        uint96 exactSize = uint96((headroomBase * SIZE_PRECISION) / 1e18); // size units
        // exactly at limit => success
        vm.prank(mm);
        vault.placeAsk(ASK_PRICE, exactSize);

        // one more tiny ask now must exceed the allowance => revert.
        vm.prank(mm);
        vm.expectRevert();
        vault.placeAsk(ASK_PRICE, 1e10);
    }

    /// @dev Clean, deterministic version of the spec boundaries using setMandate to fix
    ///      allowance and a fresh vault state (sold via formula, resting via one ask).
    function test_specBoundaries() public {
        _sell(900); // sold ~= 900
        // Post resting 50.
        vm.prank(mm);
        vault.placeAsk(ASK_PRICE, 50e10);

        uint256 sold = vault.soldBase();
        uint256 resting = vault.restingAskBaseRaw();
        // Set the allowance so headroom is exactly 50 base: allowance = sold + resting + 50.
        vm.prank(issuer);
        vault.setMandate(sold + resting + 50e18, 0);

        // new 40 => under limit => OK
        vm.prank(mm);
        uint40 idA = vault.placeAsk(ASK_PRICE, 40e10);
        vm.prank(mm);
        vault.cancelOrder(idA);

        // new 50 => exactly at limit => OK
        vm.prank(mm);
        uint40 idB = vault.placeAsk(ASK_PRICE, 50e10);
        vm.prank(mm);
        vault.cancelOrder(idB);

        // new 60 => over limit => revert with SellAllowanceExceeded
        vm.prank(mm);
        vm.expectRevert(
            abi.encodeWithSelector(
                KuruIntegrationSpike.SellAllowanceExceeded.selector, sold, resting, 60e18, sold + resting + 50e18
            )
        );
        vault.placeAsk(ASK_PRICE, 60e10);
    }
}
