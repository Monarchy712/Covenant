// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";

/// @notice PHASE 8 — gas. Measures gas USED for each op and checks linearity vs book depth
///         and vs the number of the vault's own open orders. gasleft() deltas are printed;
///         the report's cost table uses the --gas-report medians plus the Monad
///         gas-charging model (see TECHNICAL_SPIKE_REPORT.md).
contract GasTest is Base {
    uint32 constant ASK_PRICE = 5e8; // 5.0, above any reference bids we plant

    function setUp() public {
        _standardSetup(100_000e18, 0);
        vm.startPrank(issuer);
        base.approve(address(vault), 50_000e18);
        vault.depositInventory(address(base), 50_000e18);
        vm.stopPrank();
    }

    // Book depth: plant N resting bids at distinct prices via a separate maker, then measure
    // the cost of a vault placeAsk (which reads bestBidAsk — band off here, so this isolates
    // placement cost against book size).
    function _plantBids(uint256 n) internal {
        address planter = makeAddr("planter");
        quote.mint(planter, 10_000_000e6);
        vm.startPrank(planter);
        quote.approve(MARGIN, type(uint256).max);
        margin.deposit(planter, address(quote), 10_000_000e6);
        for (uint256 i = 0; i < n; i++) {
            // distinct price points below the ask, each a fresh tree node
            ob.addBuyOrder(uint32(1e8 + i * TICK_SIZE), 1e10, true);
        }
        vm.stopPrank();
    }

    function test_gas_placeAsk_bookDepth_1_20_100() public {
        _plantBids(1);
        uint256 g0 = gasleft();
        vm.prank(mm);
        vault.placeAsk(ASK_PRICE, 10e10);
        emit log_named_uint("placeAsk gas @ book depth 1", g0 - gasleft());

        _plantBids(19); // total ~20
        g0 = gasleft();
        vm.prank(mm);
        vault.placeAsk(ASK_PRICE + TICK_SIZE, 10e10);
        emit log_named_uint("placeAsk gas @ book depth ~20", g0 - gasleft());

        _plantBids(80); // total ~100
        g0 = gasleft();
        vm.prank(mm);
        vault.placeAsk(ASK_PRICE + 2 * TICK_SIZE, 10e10);
        emit log_named_uint("placeAsk gas @ book depth ~100", g0 - gasleft());
    }

    // Vault's own open orders: soldBase()/restingAskBaseRaw() iterate openAskIds. Measure
    // how a state read scales with 1 vs N vault orders (this is the term Covenant controls).
    function test_gas_soldBase_vs_ownOrders_1_20_100() public {
        vm.startPrank(mm);
        vault.placeAsk(ASK_PRICE, 10e10);
        uint256 g0 = gasleft();
        vault.soldBase();
        emit log_named_uint("soldBase gas @ 1 own ask", g0 - gasleft());

        for (uint256 i = 1; i < 20; i++) {
            vault.placeAsk(uint32(ASK_PRICE + i * TICK_SIZE), 10e10);
        }
        g0 = gasleft();
        vault.soldBase();
        emit log_named_uint("soldBase gas @ 20 own asks", g0 - gasleft());

        for (uint256 i = 20; i < 100; i++) {
            vault.placeAsk(uint32(ASK_PRICE + i * TICK_SIZE), 10e10);
        }
        g0 = gasleft();
        vault.soldBase();
        emit log_named_uint("soldBase gas @ 100 own asks", g0 - gasleft());
        vm.stopPrank();
    }
}
