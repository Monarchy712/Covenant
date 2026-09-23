// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";

/// @notice Phase 2 probe: prove a market can be created on a testnet fork and that a
///         freshly-deployed market is auto-verified in MarginAccount.
contract ProbeTest is Base {
    function test_deployMarket_andVerify() public {
        _fork();
        _deployTokensAndMarket();
        emit log_named_address("market", market);
        assertTrue(market.code.length > 0, "market has code");

        // market params round-trip
        (uint32 pp, uint96 sp, address b,, address q,,,,,,) = ob.getMarketParams();
        assertEq(pp, PRICE_PRECISION, "pricePrecision");
        assertEq(sp, SIZE_PRECISION, "sizePrecision");
        assertEq(b, address(base), "base");
        assertEq(q, address(quote), "quote");

        // The market must be verified so it can move margin (debitUser/creditUser).
        assertTrue(margin.verifiedMarket(market), "market auto-verified in MarginAccount");
    }
}
