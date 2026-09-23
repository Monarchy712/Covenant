// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {KuruIntegrationSpike} from "../src/KuruIntegrationSpike.sol";
import {MockBase, MockUSDC} from "../src/mocks/Tokens.sol";
import {IKuruOrderBook} from "../src/interfaces/IKuruOrderBook.sol";
import {IKuruMarginAccount} from "../src/interfaces/IKuruMarginAccount.sol";
import {IKuruRouter} from "../src/interfaces/IKuruRouter.sol";

/// @notice Shared fork base: forks Monad testnet, deploys mock base/quote tokens, creates
///         a REAL Kuru market via the deployed Router, and wires up the vault under test.
///         All Kuru contracts here are the real deployed bytecode (no Kuru mocks).
abstract contract Base is Test {
    // --- Real Kuru testnet addresses (verified via cast code, Phase 1) ---
    address constant ROUTER = 0x7EFbE105Ca7415dE98F96622173458ac1c054630;
    address constant MARGIN = 0xd029C2D98ff85D8F64799017fE00a59B1159CE02;

    uint256 constant FORK_BLOCK = 64938269;

    // --- Market params (mirrors the live MON/USDC market's precisions) ---
    uint96 constant SIZE_PRECISION = 1e10;
    uint32 constant PRICE_PRECISION = 1e8;
    uint32 constant TICK_SIZE = 100; // price step = 100 / 1e8 = 1e-6 quote
    uint96 constant MIN_SIZE = 1e8; // 0.01 base
    uint96 constant MAX_SIZE = 1e16; // 1e6 base
    uint256 constant TAKER_FEE_BPS = 30;
    uint256 constant MAKER_FEE_BPS = 10;
    uint96 constant AMM_SPREAD = 100;

    // Roles
    address issuer = makeAddr("issuer");
    address mm = makeAddr("mm");
    address attacker = makeAddr("attacker");
    address taker = makeAddr("taker");

    MockBase base;
    MockUSDC quote;
    address market; // deployed OrderBook proxy
    IKuruOrderBook ob;
    IKuruMarginAccount margin = IKuruMarginAccount(MARGIN);
    KuruIntegrationSpike vault;

    // Mandate defaults
    uint256 constant SELL_ALLOWANCE = 1_000e18; // 1000 base
    uint256 constant BAND_BPS = 0; // band disabled by default (enabled in band tests)

    function _fork() internal {
        vm.createSelectFork(vm.envString("RPC_URL_TESTNET"), FORK_BLOCK);
    }

    function _deployTokensAndMarket() internal {
        base = new MockBase();
        quote = new MockUSDC();

        // deployProxy is open on testnet (not onlyOwner in source; monad-maize proved it).
        market = IKuruRouter(ROUTER).deployProxy(
            IKuruRouter.OrderBookType.NO_NATIVE,
            address(base),
            address(quote),
            SIZE_PRECISION,
            PRICE_PRECISION,
            TICK_SIZE,
            MIN_SIZE,
            MAX_SIZE,
            TAKER_FEE_BPS,
            MAKER_FEE_BPS,
            AMM_SPREAD
        );
        ob = IKuruOrderBook(market);
    }

    function _deployVault(uint256 allowance, uint256 bandBps) internal {
        vault = new KuruIntegrationSpike(
            market, MARGIN, address(base), address(quote), issuer, mm, allowance, bandBps
        );
    }

    /// @notice Standard setup: fork, deploy market + vault, fund issuer, deposit inventory.
    function _standardSetup(uint256 allowance, uint256 bandBps) internal {
        _fork();
        _deployTokensAndMarket();
        _deployVault(allowance, bandBps);

        // Fund issuer with base + quote, approve vault to pull.
        base.mint(issuer, 1_000_000e18);
        quote.mint(issuer, 1_000_000e6);
    }
}
