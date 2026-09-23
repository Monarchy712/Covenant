// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {KuruIntegrationSpike} from "../src/KuruIntegrationSpike.sol";

/// @notice PHASE 6 — minimal price band. quote() reads best bid/ask from Kuru in the SAME
///         tx and requires the order price within +/- bandBps of mid. Handles the empty-side
///         sentinel type(uint256).max.
contract BandTest is Base {
    uint32 constant REF_BID = 1e8; // 1.0
    uint32 constant REF_ASK = 3e8; // 3.0  => mid 2.0 (2e8)
    uint256 constant BAND = 500; // +/-5%

    address refMaker = makeAddr("refMaker");

    function _setupWithBand() internal {
        _standardSetup(SELL_ALLOWANCE, BAND);
        // vault inventory
        vm.startPrank(issuer);
        base.approve(address(vault), 1_000e18);
        quote.approve(address(vault), 1_000e6);
        vault.depositInventory(address(base), 1_000e18);
        vault.depositInventory(address(quote), 1_000e6);
        vm.stopPrank();
    }

    /// @dev Build a two-sided reference book directly on the OrderBook via a separate maker,
    ///      so mid is defined. refMaker deposits its own margin and posts a bid + ask.
    function _buildReferenceBook() internal {
        base.mint(refMaker, 1_000e18);
        quote.mint(refMaker, 10_000e6);
        vm.startPrank(refMaker);
        base.approve(MARGIN, type(uint256).max);
        quote.approve(MARGIN, type(uint256).max);
        margin.deposit(refMaker, address(base), 1_000e18);
        margin.deposit(refMaker, address(quote), 10_000e6);
        ob.addBuyOrder(REF_BID, 10e10, true); // bid 1.0
        ob.addSellOrder(REF_ASK, 10e10, true); // ask 3.0
        vm.stopPrank();
    }

    function test_midReadInSameTx() public {
        _setupWithBand();
        _buildReferenceBook();
        (uint256 mid, bool hb, bool ha) = vault.priceMid();
        emit log_named_uint("mid", mid);
        assertTrue(hb && ha, "both sides present");
        assertEq(mid, 2e18, "mid == 2.0 at 18-dec scale (bestBidAsk units)");
    }

    function test_validPrice() public {
        _setupWithBand();
        _buildReferenceBook();
        // 2.0 is exactly mid; well within +/-5%. Post-only bid at 2.0 (> best bid, < best ask).
        vm.prank(mm);
        vault.placeBid(2e8, 5e10);
    }

    function test_boundaryPrice() public {
        _setupWithBand();
        _buildReferenceBook();
        // hi bound = mid*(1+5%) = 2.1e8. Placing an ASK at exactly 2.1e8 must pass the band
        // (and rests since 2.1 < best ask 3.0, post-only ok).
        uint32 hi = uint32((uint256(2e8) * (10_000 + BAND)) / 10_000); // 2.1e8
        vm.prank(mm);
        vault.placeAsk(hi, 5e10);
    }

    function test_invalidPrice_reverts() public {
        _setupWithBand();
        _buildReferenceBook();
        // 2.5 (+25%) is outside +/-5% => PriceOutOfBand. Revert args at 18-dec scale.
        // price18 = 25e7 * 1e18 / 1e8 = 2.5e18; bounds = mid(2e18) +/-5%.
        vm.prank(mm);
        vm.expectRevert(
            abi.encodeWithSelector(
                KuruIntegrationSpike.PriceOutOfBand.selector,
                uint256(25e17), // 2.5e18
                (uint256(2e18) * (10_000 - BAND)) / 10_000, // 1.9e18
                (uint256(2e18) * (10_000 + BAND)) / 10_000 // 2.1e18
            )
        );
        vault.placeAsk(25e7, 5e10);
    }

    function test_emptyBook_reverts() public {
        _setupWithBand();
        // No reference orders: bestBidAsk returns the empty sentinels => EmptyBook.
        vm.prank(mm);
        vm.expectRevert(KuruIntegrationSpike.EmptyBook.selector);
        vault.placeAsk(2e8, 5e10);
    }

    function test_oneSidedBook_usesPresentSide() public {
        _setupWithBand();
        // Only a bid exists => mid falls back to best bid (1.0). Band around 1.0 => [0.95,1.05].
        base.mint(refMaker, 1_000e18);
        quote.mint(refMaker, 10_000e6);
        vm.startPrank(refMaker);
        quote.approve(MARGIN, type(uint256).max);
        margin.deposit(refMaker, address(quote), 10_000e6);
        ob.addBuyOrder(REF_BID, 10e10, true); // only a bid at 1.0
        vm.stopPrank();

        (uint256 mid, bool hb, bool ha) = vault.priceMid();
        assertTrue(hb && !ha, "only bid side present");
        assertEq(mid, 1e18, "mid falls back to best bid (18-dec scale)");

        // ask at 1.05 (hi bound) ok; ask at 1.5 out of band.
        vm.prank(mm);
        vault.placeAsk(uint32((uint256(1e8) * (10_000 + BAND)) / 10_000), 5e10);
        vm.prank(mm);
        vm.expectRevert();
        vault.placeAsk(15e7, 5e10);
    }
}
