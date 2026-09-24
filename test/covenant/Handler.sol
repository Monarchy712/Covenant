// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {CovenantVault} from "../../src/covenant/CovenantVault.sol";
import {State} from "../../src/covenant/CovenantTypes.sol";
import {MockBase, MockUSDC} from "../../src/mocks/Tokens.sol";
import {IKuruOrderBook} from "../../src/interfaces/IKuruOrderBook.sol";

/// @notice Stateful fuzz handler: random quote/cancel/fill/checkpoint/poke/warp/pause on one
///         live vault. warp() always pokes so windows stay fresh (the keeper's regime).
contract Handler is Test {
    CovenantVault public vault;
    IKuruOrderBook public ob;
    MockBase public base;
    MockUSDC public quote;
    address public mm;
    address public taker;
    address public issuer;
    uint32 public pricePrecision;

    uint256 public mmClaimedTotal; // running total the MM has claimed

    constructor(
        CovenantVault _vault,
        IKuruOrderBook _ob,
        MockBase _base,
        MockUSDC _quote,
        address _mm,
        address _taker,
        address _issuer
    ) {
        vault = _vault;
        ob = _ob;
        base = _base;
        quote = _quote;
        mm = _mm;
        taker = _taker;
        issuer = _issuer;
        base.mint(taker, 100_000_000e18);
        quote.mint(taker, 100_000_000e6);
    }

    function _u32(uint32 a) internal pure returns (uint32[] memory r) {
        r = new uint32[](1);
        r[0] = a;
    }

    function _u96(uint96 a) internal pure returns (uint96[] memory r) {
        r = new uint96[](1);
        r[0] = a;
    }

    function _e32() internal pure returns (uint32[] memory r) {
        r = new uint32[](0);
    }

    function _e96() internal pure returns (uint96[] memory r) {
        r = new uint96[](0);
    }

    function _e40() internal pure returns (uint40[] memory r) {
        r = new uint40[](0);
    }

    // Random two-sided quote within a plausible band around 2.0 (prices multiples of tick 100).
    function doQuote(uint256 bidSeed, uint256 askSeed, uint96 size) public {
        uint32 bid = uint32(198_000_000 + (bidSeed % 20) * 100_000); // 1.98..2.0
        uint32 ask = uint32(200_000_000 + (askSeed % 20) * 100_000); // 2.0..2.02
        size = uint96(bound(size, 1e10, 50e10)); // 1..50 base
        vm.prank(mm);
        try vault.quote(_u32(bid), _u96(size), _u32(ask), _u96(size), _e40()) {} catch {}
    }

    function cancelFirstAsk() public {
        if (vault.openAskCount() == 0) return;
        uint40 id = vault.openAskIds(0);
        vm.prank(mm);
        try vault.cancel(_singleton(id)) {} catch {}
    }

    function takerBuy(uint256 amt) public {
        uint96 q = uint96(bound(amt, 1e8, 20e8)); // small quote-precision buys
        vm.startPrank(taker);
        quote.approve(address(ob), type(uint256).max);
        try ob.placeAndExecuteMarketBuy(q, 0, false, false) {} catch {}
        vm.stopPrank();
    }

    function takerSell(uint256 baseWhole) public {
        uint256 n = bound(baseWhole, 1, 20);
        vm.startPrank(taker);
        base.approve(address(ob), type(uint256).max);
        try ob.placeAndExecuteMarketSell(uint96(n * 1e10), 0, false, false) {} catch {}
        vm.stopPrank();
    }

    function doCheckpoint() public {
        try vault.checkpoint() {} catch {}
    }

    function doClaim() public {
        uint256 before = quote.balanceOf(mm);
        vm.prank(mm);
        try vault.claimFees() {
            mmClaimedTotal += quote.balanceOf(mm) - before;
        } catch {}
    }

    function warp(uint256 dt) public {
        dt = bound(dt, 1, 5 minutes);
        vm.warp(block.timestamp + dt);
        try vault.poke() {} catch {} // keep windows fresh
    }

    function pauseToggle() public {
        State s = vault.currentState();
        vm.prank(issuer);
        if (s == State.ACTIVE) {
            try vault.pause() {} catch {}
        } else if (s == State.PAUSED) {
            try vault.unpause() {} catch {}
        }
    }

    function _singleton(uint40 a) internal pure returns (uint40[] memory r) {
        r = new uint40[](1);
        r[0] = a;
    }
}
