// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {CovenantFactory} from "../../src/covenant/CovenantFactory.sol";
import {CovenantVault} from "../../src/covenant/CovenantVault.sol";
import {Terms, State} from "../../src/covenant/CovenantTypes.sol";
import {MockBase, MockUSDC} from "../../src/mocks/Tokens.sol";
import {IKuruOrderBook} from "../../src/interfaces/IKuruOrderBook.sol";
import {IKuruMarginAccount} from "../../src/interfaces/IKuruMarginAccount.sol";
import {IKuruRouter} from "../../src/interfaces/IKuruRouter.sol";

/// @notice Shared fork fixture for Covenant tests. Forks Monad testnet, deploys mock base/quote,
///         creates a REAL Kuru market via the deployed Router, deploys the factory with the real
///         MarginAccount, and exposes mandate-setup helpers. All Kuru contracts are real bytecode.
abstract contract CovenantBase is Test {
    // Real Kuru testnet addresses (verified in Phase 1, docs/KURU_ARCHITECTURE.md).
    address constant ROUTER = 0x7EFbE105Ca7415dE98F96622173458ac1c054630;
    address constant MARGIN = 0xd029C2D98ff85D8F64799017fE00a59B1159CE02;
    uint256 constant FORK_BLOCK = 64938269;

    // Market params (mirror the live MON/USDC market's precisions).
    uint96 constant SIZE_PRECISION = 1e10;
    uint32 constant PRICE_PRECISION = 1e8;
    uint32 constant TICK_SIZE = 100;
    uint96 constant MIN_SIZE = 1e8;
    uint96 constant MAX_SIZE = 1e16;
    uint96 constant AMM_SPREAD = 100;

    // Default term values.
    uint256 constant NET_CAP = 1_000e18; // 1000 base per window
    uint256 constant WINDOW = 1 hours;
    uint256 constant BAND_BPS = 200; // ±2%
    uint256 constant MAX_OPEN = 5;
    uint256 constant MAX_SPREAD_BPS = 100; // 1%
    uint256 constant MIN_DEPTH = 1e18; // 1 base
    uint256 constant CHECKPOINT = 10 minutes;
    uint256 constant FEE_PER = 50e6; // 50 USDC
    uint256 constant DURATION = 30 days;
    uint256 constant MAX_FAILS = 3;

    // Prices (pricePrecision units): mid ~ 2.0. Multiples of TICK_SIZE(100).
    uint32 constant BID_PX = 199_500_000; // 1.995
    uint32 constant ASK_PX = 200_500_000; // 2.005  -> spread 0.5% = 50 bps
    uint96 constant QTY = 100e10; // 100 base

    address issuer = makeAddr("issuer");
    address mm = makeAddr("mm");
    address taker = makeAddr("taker");
    address attacker = makeAddr("attacker");

    MockBase base;
    MockUSDC quote;
    address market;
    IKuruOrderBook ob;
    IKuruMarginAccount margin = IKuruMarginAccount(MARGIN);
    CovenantFactory factory;
    CovenantVault vault;

    function _fork() internal {
        vm.createSelectFork(vm.envString("RPC_URL_TESTNET"), FORK_BLOCK);
    }

    function _deployMarket() internal {
        base = new MockBase();
        quote = new MockUSDC();
        market = IKuruRouter(ROUTER)
            .deployProxy(
                IKuruRouter.OrderBookType.NO_NATIVE,
                address(base),
                address(quote),
                SIZE_PRECISION,
                PRICE_PRECISION,
                TICK_SIZE,
                MIN_SIZE,
                MAX_SIZE,
                30,
                10,
                AMM_SPREAD
            );
        ob = IKuruOrderBook(market);
    }

    function _defaultTerms() internal view returns (Terms memory t) {
        t = Terms({
            market: market,
            baseToken: address(base),
            quoteToken: address(quote),
            issuer: issuer, // overridden by factory to msg.sender
            mm: mm,
            netSellCapPerWindow: NET_CAP,
            windowLength: WINDOW,
            bandBps: BAND_BPS,
            maxOpenPerSide: MAX_OPEN,
            maxSpreadBps: MAX_SPREAD_BPS,
            minDepthPerSide: MIN_DEPTH,
            checkpointInterval: CHECKPOINT,
            feePerInterval: FEE_PER,
            duration: DURATION,
            maxConsecutiveFails: MAX_FAILS
        });
    }

    function _createMandate(Terms memory t) internal returns (CovenantVault v) {
        vm.prank(issuer);
        address addr = factory.createMandate(t);
        v = CovenantVault(addr);
    }

    /// @notice Full setup to ACTIVE: fork, market, factory, create, accept, deposit, fund, activate.
    function _setupActive() internal {
        _fork();
        _deployMarket();
        factory = new CovenantFactory(MARGIN);
        vault = _createMandate(_defaultTerms());

        // fund issuer + accept
        base.mint(issuer, 1_000_000e18);
        quote.mint(issuer, 1_000_000e6);
        vm.prank(mm);
        vault.accept();

        vm.startPrank(issuer);
        base.approve(address(vault), 10_000e18);
        quote.approve(address(vault), 10_000e6);
        vault.depositInventory(address(base), 5_000e18);
        vault.depositInventory(address(quote), 5_000e6);
        vault.fundFees(1_000e6); // 20 checkpoints of headroom
        vault.activate();
        vm.stopPrank();
    }

    /// @notice Place a tight two-sided quote through the vault (passes band + governor).
    function _quoteTwoSided() internal {
        uint32[] memory bp = new uint32[](1);
        uint96[] memory bs = new uint96[](1);
        uint32[] memory ap = new uint32[](1);
        uint96[] memory as_ = new uint96[](1);
        uint40[] memory none = new uint40[](0);
        bp[0] = BID_PX;
        bs[0] = QTY;
        ap[0] = ASK_PX;
        as_[0] = QTY;
        vm.prank(mm);
        vault.quote(bp, bs, ap, as_, none);
    }

    /// @notice Taker buys `baseWhole` base off the vault's ask.
    function _takerBuy(uint256 baseWhole) internal {
        quote.mint(taker, 1_000_000e6);
        vm.startPrank(taker);
        quote.approve(market, type(uint256).max);
        ob.placeAndExecuteMarketBuy(uint96(baseWhole * ASK_PX), 0, false, false);
        vm.stopPrank();
    }

    // one-element array helpers
    function _u32(uint32 a) internal pure returns (uint32[] memory r) {
        r = new uint32[](1);
        r[0] = a;
    }

    function _u96(uint96 a) internal pure returns (uint96[] memory r) {
        r = new uint96[](1);
        r[0] = a;
    }

    function _u40(uint40 a) internal pure returns (uint40[] memory r) {
        r = new uint40[](1);
        r[0] = a;
    }

    function _empty32() internal pure returns (uint32[] memory r) {
        r = new uint32[](0);
    }

    function _empty96() internal pure returns (uint96[] memory r) {
        r = new uint96[](0);
    }

    function _empty40() internal pure returns (uint40[] memory r) {
        r = new uint40[](0);
    }
}
