// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {CovenantFactory} from "../src/covenant/CovenantFactory.sol";
import {CovenantVault} from "../src/covenant/CovenantVault.sol";
import {Terms, State} from "../src/covenant/CovenantTypes.sol";
import {MockBase, MockUSDC} from "../src/mocks/Tokens.sol";
import {IKuruOrderBook} from "../src/interfaces/IKuruOrderBook.sol";
import {IKuruRouter} from "../src/interfaces/IKuruRouter.sol";

/// @notice Deploy CovenantFactory to Monad testnet + run one smoke mandate end-to-end.
/// Run (tight gas limits — Monad charges the LIMIT):
///   forge script script/DeployCovenant.s.sol --rpc-url $RPC_URL_TESTNET --broadcast \
///     --gas-estimate-multiplier 115 -vvvv
contract DeployCovenant is Script {
    address constant ROUTER = 0x7EFbE105Ca7415dE98F96622173458ac1c054630;
    address constant MARGIN = 0xd029C2D98ff85D8F64799017fE00a59B1159CE02;

    uint96 constant SIZE_PRECISION = 1e10;
    uint32 constant PRICE_PRECISION = 1e8;
    uint32 constant TICK_SIZE = 100;
    uint96 constant MIN_SIZE = 1e8;
    uint96 constant MAX_SIZE = 1e16;

    uint32 constant BID_PX = 199_500_000; // 1.995
    uint32 constant ASK_PX = 200_500_000; // 2.005
    uint96 constant QTY = 100e10; // 100 base

    function run() external {
        uint256 pkDeployer = vm.envUint("PRIVATE_KEY_DEPLOYER"); // issuer
        uint256 pkMM = vm.envUint("PRIVATE_KEY_MM");
        uint256 pkTaker = vm.envUint("PRIVATE_KEY_TAKER");
        address issuer = vm.addr(pkDeployer);
        address mmAddr = vm.addr(pkMM);
        address takerAddr = vm.addr(pkTaker);

        // 1) Deployer: tokens, market, factory, mandate, funding.
        vm.startBroadcast(pkDeployer);
        MockBase base = new MockBase();
        MockUSDC quote = new MockUSDC();
        address market = IKuruRouter(ROUTER)
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
                100
            );
        CovenantFactory factory = new CovenantFactory(MARGIN);

        Terms memory t = Terms({
            market: market,
            baseToken: address(base),
            quoteToken: address(quote),
            issuer: issuer,
            mm: mmAddr,
            netSellCapPerWindow: 1_000e18,
            windowLength: 1 hours,
            bandBps: 200,
            maxOpenPerSide: 5,
            maxSpreadBps: 100,
            minDepthPerSide: 1e18,
            checkpointInterval: 2 minutes,
            feePerInterval: 50e6,
            duration: 30 days,
            maxConsecutiveFails: 3
        });
        address vaultAddr = factory.createMandate(t);
        CovenantVault vault = CovenantVault(vaultAddr);

        base.mint(issuer, 10_000e18);
        quote.mint(issuer, 10_000e6);
        quote.mint(takerAddr, 10_000e6);
        base.approve(vaultAddr, 5_000e18);
        quote.approve(vaultAddr, 2_000e6);
        vm.stopBroadcast();

        // 2) MM accepts, pinning the terms hash it reviewed.
        bytes32 h = vault.termsHash();
        vm.startBroadcast(pkMM);
        vault.accept(h);
        vm.stopBroadcast();

        // 3) Deployer deposits + funds + activates.
        vm.startBroadcast(pkDeployer);
        vault.depositInventory(address(base), 1_000e18);
        vault.depositInventory(address(quote), 1_000e6);
        vault.fundFees(500e6);
        vault.activate();
        vm.stopBroadcast();

        // 4) MM quotes two-sided.
        vm.startBroadcast(pkMM);
        vault.quote(_u32(BID_PX), _u96(QTY), _u32(ASK_PX), _u96(QTY), _e40());
        vm.stopBroadcast();

        // 5) Taker fills 40 base off the ask.
        vm.startBroadcast(pkTaker);
        quote.approve(market, type(uint256).max);
        IKuruOrderBook(market).placeAndExecuteMarketBuy(uint96(uint256(40) * ASK_PX), 0, false, false);
        vm.stopBroadcast();

        // 6) Anyone checkpoints.
        vm.startBroadcast(pkTaker);
        vault.checkpoint();
        vm.stopBroadcast();

        console2.log("factory", address(factory));
        console2.log("implementation", factory.implementation());
        console2.log("market", market);
        console2.log("vault", vaultAddr);
        console2.log("base", address(base));
        console2.log("quote", address(quote));
        console2.log("soldBase", vm.toString(vault.soldBaseSigned()));

        // 7) Write deployment addresses.
        string memory o = "dep";
        vm.serializeAddress(o, "factory", address(factory));
        vm.serializeAddress(o, "implementation", factory.implementation());
        vm.serializeAddress(o, "market", market);
        vm.serializeAddress(o, "vault", vaultAddr);
        vm.serializeAddress(o, "base", address(base));
        string memory out = vm.serializeAddress(o, "quote", address(quote));
        vm.writeJson(out, "./deployments/testnet.json");
    }

    function _u32(uint32 a) internal pure returns (uint32[] memory r) {
        r = new uint32[](1);
        r[0] = a;
    }

    function _u96(uint96 a) internal pure returns (uint96[] memory r) {
        r = new uint96[](1);
        r[0] = a;
    }

    function _e40() internal pure returns (uint40[] memory r) {
        r = new uint40[](0);
    }
}
