// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {IKuruOrderBook} from "../src/interfaces/IKuruOrderBook.sol";

/// @notice PHASE 4 — fill tracking (CRITICAL, STOP CHECK B).
///
/// Verified accounting (see test/Diag.t.sol for the raw measurement):
///   - Placing an ask of size S debits exactly S base from the vault's free margin.
///   - A fill of `matched` base reduces the order's remaining size by exactly `matched`
///     (gross, exact) and CREDITS the maker a rebate of makerFeeBps*matched BACK into
///     free base margin. The taker separately pays takerFeeBps out of its received base.
///   - The vault's on-chain sold measure:
///
///         soldBase = baseDeposited - getBalance(vault,base) - Σ remaining ask sizes
///
///     equals NET base disposed = matched * (1 - makerFeeBps/1e4). It is exact to
///     sizePrecision integer rounding; the only deviation from gross-matched is the
///     maker rebate, a bounded, explainable term (<= makerFeeBps/1e4 of matched).
contract FillsTest is Base {
    uint32 constant ASK_PRICE = 2e8; // price units => 2.0 quote/base
    uint96 constant ASK_SIZE = 100e10; // 100 base

    function setUp() public {
        _standardSetup(SELL_ALLOWANCE, 0);
        vm.startPrank(issuer);
        base.approve(address(vault), 500e18);
        vault.depositInventory(address(base), 500e18);
        vm.stopPrank();
        quote.mint(taker, 1_000_000e6);
    }

    /// @dev Market-buy `baseWhole` base off the book. _quoteAmount is in PRICE-PRECISION
    ///      units: to match B base at price P (price units), pass B*P. Not fill-or-kill.
    function _takerBuyBase(uint256 baseWhole) internal {
        uint96 qty = uint96(baseWhole * ASK_PRICE);
        vm.startPrank(taker);
        quote.approve(market, type(uint256).max);
        ob.placeAndExecuteMarketBuy(qty, 0, false, false);
        vm.stopPrank();
    }

    /// @dev Expected net-sold for `matchedWhole` base gross, accounting for the maker rebate.
    function _expectedNetSold(uint256 matchedWhole) internal pure returns (uint256) {
        return (matchedWhole * 1e18 * (10_000 - MAKER_FEE_BPS)) / 10_000;
    }

    function test_soldZeroInitially() public {
        vm.prank(mm);
        vault.placeAsk(ASK_PRICE, ASK_SIZE);
        assertEq(vault.soldBase(), 0, "no fills yet => sold 0");
        assertEq(vault.restingAskBaseRaw(), 100e18, "100 base locked in the resting ask");
    }

    function test_partialFill() public {
        vm.prank(mm);
        uint40 id = vault.placeAsk(ASK_PRICE, ASK_SIZE);
        _takerBuyBase(40);

        IKuruOrderBook.Order memory o = vault.getOrder(id);
        uint256 matched = 100e18 - (uint256(o.size) * 1e18) / SIZE_PRECISION; // gross, from order
        assertEq(matched, 40e18, "order remaining shows exactly 40 base matched (gross, exact)");

        // formula tracks NET disposed = matched - maker rebate, exact to rounding.
        assertApproxEqAbs(vault.soldBase(), _expectedNetSold(40), 1e12, "soldBase == matched net of maker rebate");
        // proceeds landed in the vault's quote margin.
        assertEq(margin.getBalance(address(vault), address(quote)), 80e6, "80 USDC proceeds (40 base @ 2.0)");
    }

    function test_fullFill() public {
        vm.prank(mm);
        uint40 id = vault.placeAsk(ASK_PRICE, ASK_SIZE);
        _takerBuyBase(100);

        IKuruOrderBook.Order memory o = vault.getOrder(id);
        assertEq(o.size, 0, "ask fully consumed");
        assertApproxEqAbs(vault.soldBase(), _expectedNetSold(100), 1e12, "~100 base net sold");
    }

    function test_partialThenCancel() public {
        vm.prank(mm);
        uint40 id = vault.placeAsk(ASK_PRICE, ASK_SIZE);
        _takerBuyBase(40);
        uint256 soldAfterFill = vault.soldBase();

        vm.prank(mm);
        vault.cancelOrder(id);

        assertEq(vault.restingAskBaseRaw(), 0, "no resting asks after cancel");
        // Cancel frees only the UNSOLD remainder; sold is unchanged.
        assertApproxEqAbs(vault.soldBase(), soldAfterFill, 1, "sold unchanged by cancel");
        assertApproxEqAbs(vault.soldBase(), _expectedNetSold(40), 1e12, "~40 net sold persists");
    }

    function test_replaceThenFill() public {
        vm.prank(mm);
        uint40 id1 = vault.placeAsk(ASK_PRICE, ASK_SIZE);
        _takerBuyBase(40);
        uint256 soldA = vault.soldBase();

        vm.prank(mm);
        uint40 id2 = vault.replaceAskAtomic(id1, ASK_PRICE, 50e10); // new 50-base ask

        assertApproxEqAbs(vault.soldBase(), soldA, 1, "sold unchanged by replace");

        _takerBuyBase(30); // 30 off the new ask
        IKuruOrderBook.Order memory o2 = vault.getOrder(id2);
        assertEq(o2.size, 20e10, "20 base remaining on the replacement ask");
        assertApproxEqAbs(vault.soldBase(), _expectedNetSold(70), 2e12, "~70 base net sold cumulatively");
    }

    function test_twoFillsSameBlock() public {
        vm.prank(mm);
        vault.placeAsk(ASK_PRICE, ASK_SIZE);

        address taker2 = makeAddr("taker2");
        quote.mint(taker2, 1_000_000e6);

        uint256 snapBlock = block.number;
        _takerBuyBase(20);
        vm.startPrank(taker2);
        quote.approve(market, type(uint256).max);
        ob.placeAndExecuteMarketBuy(uint96(uint256(20) * ASK_PRICE), 0, false, false);
        vm.stopPrank();
        assertEq(block.number, snapBlock, "same block (no roll)");

        assertApproxEqAbs(vault.soldBase(), _expectedNetSold(40), 2e12, "~40 net sold across two same-block fills");
    }

    // Dust / rounding edge: a sub-1-base fill still accounts exactly to rounding.
    function test_dustFill() public {
        vm.prank(mm);
        uint40 id = vault.placeAsk(ASK_PRICE, ASK_SIZE);
        // match 0.01 base (== MIN_SIZE worth): quoteAmount = 0.01 * ASK_PRICE
        vm.startPrank(taker);
        quote.approve(market, type(uint256).max);
        ob.placeAndExecuteMarketBuy(uint96(ASK_PRICE / 100), 0, false, false);
        vm.stopPrank();

        IKuruOrderBook.Order memory o = vault.getOrder(id);
        uint256 matched = 100e18 - (uint256(o.size) * 1e18) / SIZE_PRECISION;
        emit log_named_uint("dust matched (base)", matched);
        emit log_named_uint("soldBase", vault.soldBase());
        // conservation still holds: sold == matched net of rebate, within one sizePrecision tick.
        assertApproxEqAbs(vault.soldBase(), (matched * (10_000 - MAKER_FEE_BPS)) / 10_000, 1e9, "dust accounted");
    }
}
