// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {KuruIntegrationSpike} from "../src/KuruIntegrationSpike.sol";
import {MockBase, MockUSDC} from "../src/mocks/Tokens.sol";
import {IKuruOrderBook} from "../src/interfaces/IKuruOrderBook.sol";
import {IKuruMarginAccount} from "../src/interfaces/IKuruMarginAccount.sol";
import {IKuruRouter} from "../src/interfaces/IKuruRouter.sol";

/// @notice PHASE 9 — full lifecycle on REAL Monad testnet via `forge script --broadcast`.
///         Deploys mock tokens + market + vault, deposits, places an ask, has the taker
///         fill part of it, cancels, replaces, and demonstrates a governor revert.
///         Reads the four funded keys from .env (never committed).
///
/// Run:
///   forge script script/FullLifecycle.s.sol --rpc-url $RPC_URL_TESTNET --broadcast -vvvv
contract FullLifecycle is Script {
    address constant ROUTER = 0x7EFbE105Ca7415dE98F96622173458ac1c054630;
    address constant MARGIN = 0xd029C2D98ff85D8F64799017fE00a59B1159CE02;

    uint96 constant SIZE_PRECISION = 1e10;
    uint32 constant PRICE_PRECISION = 1e8;
    uint32 constant TICK_SIZE = 100;
    uint96 constant MIN_SIZE = 1e8;
    uint96 constant MAX_SIZE = 1e16;
    uint32 constant ASK_PRICE = 2e8; // 2.0 quote/base

    function run() external {
        uint256 pkDeployer = vm.envUint("PRIVATE_KEY_DEPLOYER"); // issuer
        uint256 pkMM = vm.envUint("PRIVATE_KEY_MM");
        uint256 pkTaker = vm.envUint("PRIVATE_KEY_TAKER");
        address issuer = vm.addr(pkDeployer);
        address mm = vm.addr(pkMM);
        address taker = vm.addr(pkTaker);

        // 1) Deployer deploys tokens, market, vault; deposits inventory.
        vm.startBroadcast(pkDeployer);
        MockBase base = new MockBase();
        MockUSDC quote = new MockUSDC();
        console2.log("base", address(base));
        console2.log("quote", address(quote));

        address market = IKuruRouter(ROUTER).deployProxy(
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
            100
        );
        console2.log("market", market);

        KuruIntegrationSpike vault =
            new KuruIntegrationSpike(market, MARGIN, address(base), address(quote), issuer, mm, 1_000e18, 0);
        console2.log("vault", address(vault));

        base.mint(issuer, 1_000e18);
        base.approve(address(vault), 500e18);
        vault.depositInventory(address(base), 500e18);
        console2.log("deposited base margin", IKuruMarginAccount(MARGIN).getBalance(address(vault), address(base)));

        base.mint(taker, 0); // no-op keep taker referenced
        quote.mint(taker, 10_000e6); // fund taker to buy
        vm.stopBroadcast();

        // 2) MM places a post-only ask through the vault.
        vm.startBroadcast(pkMM);
        uint40 id = vault.placeAsk(ASK_PRICE, 100e10);
        console2.log("placed ask id", uint256(id));
        vm.stopBroadcast();

        // 3) Taker partially fills (40 base).
        vm.startBroadcast(pkTaker);
        quote.approve(market, type(uint256).max);
        IKuruOrderBook(market).placeAndExecuteMarketBuy(uint96(uint256(40) * ASK_PRICE), 0, false, false);
        vm.stopBroadcast();
        console2.log("soldBase after partial fill", vault.soldBase());

        // 4) MM cancels then replaces (atomic).
        vm.startBroadcast(pkMM);
        uint40 id2 = vault.replaceAskAtomic(id, ASK_PRICE + TICK_SIZE, 50e10);
        console2.log("replaced -> new id", uint256(id2));
        vm.stopBroadcast();

        console2.log("final soldBase", vault.soldBase());
        console2.log("final resting ask base", vault.restingAskBaseRaw());
    }
}
