// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {IKuruOrderBook} from "../src/interfaces/IKuruOrderBook.sol";

/// @notice Diagnostic (not a spec test): measure every base/quote flow around a single
///         partial fill to pin the exact conservation identity and the maker-fee term.
contract DiagTest is Base {
    uint32 constant ASK_PRICE = 2e8; // price units

    function test_measure() public {
        _standardSetup(SELL_ALLOWANCE, 0);
        vm.startPrank(issuer);
        base.approve(address(vault), 500e18);
        vault.depositInventory(address(base), 500e18);
        vm.stopPrank();
        quote.mint(taker, 1_000_000e6);

        uint256 depBase = vault.baseDepositedCumulative();
        uint256 freeBase0 = margin.getBalance(address(vault), address(base));
        emit log_named_uint("deposited base", depBase);
        emit log_named_uint("free base after deposit", freeBase0);

        // place 100-base ask
        vm.prank(mm);
        uint40 id = vault.placeAsk(ASK_PRICE, 100e10);
        emit log_named_uint("free base after placing 100-ask", margin.getBalance(address(vault), address(base)));
        emit log_named_uint("locked (restingAskBaseRaw)", vault.restingAskBaseRaw());

        // taker buys 40 base: quoteAmount (price-precision units) = 40 * ASK_PRICE
        uint96 qty = uint96(uint256(40) * ASK_PRICE);
        vm.startPrank(taker);
        quote.approve(market, type(uint256).max);
        uint256 takerBaseBefore = base.balanceOf(taker);
        uint256 takerQuoteBefore = quote.balanceOf(taker);
        ob.placeAndExecuteMarketBuy(qty, 0, false, false);
        uint256 takerBaseGained = base.balanceOf(taker) - takerBaseBefore;
        uint256 takerQuoteSpent = takerQuoteBefore - quote.balanceOf(taker);
        vm.stopPrank();

        emit log_named_uint("taker base gained (gross filled)", takerBaseGained);
        emit log_named_uint("taker quote spent (raw)", takerQuoteSpent);

        uint256 freeBase1 = margin.getBalance(address(vault), address(base));
        uint256 locked1 = vault.restingAskBaseRaw();
        IKuruOrderBook.Order memory o = vault.getOrder(id);
        emit log_named_uint("free base after fill", freeBase1);
        emit log_named_uint("locked after fill", locked1);
        emit log_named_uint("remaining o.size (units)", o.size);
        emit log_named_uint("vault quote margin (proceeds)", margin.getBalance(address(vault), address(quote)));
        emit log_named_uint("soldBase() formula", vault.soldBase());

        // identity components
        emit log_named_int(
            "deposited - free - locked - takerGained (should be ~ -rebate)",
            int256(depBase) - int256(freeBase1) - int256(locked1) - int256(takerBaseGained)
        );
    }
}
