// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CovenantBase} from "./CovenantBase.t.sol";
import {CovenantFactory} from "../../src/covenant/CovenantFactory.sol";
import {CovenantVault} from "../../src/covenant/CovenantVault.sol";
import {Terms} from "../../src/covenant/CovenantTypes.sol";
import {ReentrantQuote} from "./mocks/ReentrantQuote.sol";
import {MockBase} from "../../src/mocks/Tokens.sol";
import {IKuruRouter} from "../../src/interfaces/IKuruRouter.sol";
import {IKuruOrderBook} from "../../src/interfaces/IKuruOrderBook.sol";

/// @notice Suite 9 — adversarial: inventory can't leave to the MM; direct Kuru attacks fail;
///         terms lock after accept; reentrancy on claim is blocked; self-trade is bounded.
contract AdversarialTest is CovenantBase {
    function setUp() public {
        _setupActive();
        _quoteTwoSided();
    }

    // MM has no path to pull base/quote inventory — only issuer-gated withdraw exists.
    function test_mm_cannotExtractInventory() public {
        vm.startPrank(mm);
        vm.expectRevert(CovenantVault.NotIssuer.selector);
        vault.withdraw();
        vm.expectRevert(CovenantVault.NotIssuer.selector);
        vault.depositInventory(address(base), 0); // even a no-op deposit is issuer-only
        vm.stopPrank();
    }

    // MarginAccount.withdraw is self-keyed: MM/attacker withdrawing can't touch vault margin.
    function test_mm_directMarginWithdraw_cannotTouchVault() public {
        uint256 vaultBase = margin.getBalance(address(vault), address(base));
        vm.prank(mm);
        try margin.withdraw(vaultBase, address(base)) {
            fail();
        } catch {}
        assertEq(margin.getBalance(address(vault), address(base)), vaultBase, "vault margin intact");
    }

    // Direct OrderBook cancel of the vault's order fails (owner-checked against _msgSender()).
    function test_attacker_cannotCancelVaultOrderDirectly() public {
        uint40 askId = vault.openAskIds(0);
        uint40[] memory ids = new uint40[](1);
        ids[0] = askId;
        vm.prank(attacker);
        vm.expectRevert();
        ob.batchCancelOrders(ids);
        (address owner,,,,,,,) = ob.s_orders(askId);
        assertEq(owner, address(vault), "order still owned by vault");
    }

    // Terms cannot change after the MM accepts.
    function test_termsLockedAfterAccept() public {
        Terms memory t = _defaultTerms();
        t.issuer = issuer;
        t.bandBps = 500;
        vm.prank(issuer);
        vm.expectRevert(CovenantVault.TermsLocked.selector);
        vault.updateTerms(t);
    }

    // Self-trade: MM lifts its own ask via a taker wallet. Not theft — vault paid fairly and
    // the volume counts against the net-sell cap (bounded by band × cap).
    function test_selfTrade_boundedNotTheft() public {
        uint256 vaultQuoteBefore = margin.getBalance(address(vault), address(quote));
        _takerBuy(50); // 50 base off the ask @ ~2.005
        uint256 proceeds = margin.getBalance(address(vault), address(quote)) - vaultQuoteBefore;
        assertApproxEqAbs(proceeds, 100e6, 2e6, "vault paid ~ 50*2.005 quote");
        vault.poke();
        assertGt(uint256(vault.soldBaseSigned()), 0, "sale counts against the cap");
    }

    // Reentrancy: a malicious fee token that re-enters claimFees is blocked by ReentrancyGuard.
    function test_reentrancyOnClaim_blocked() public {
        // Build a dedicated mandate whose QUOTE/fee token re-enters on transfer.
        _fork();
        MockBase b = new MockBase();
        ReentrantQuote rq = new ReentrantQuote();
        address mkt = IKuruRouter(ROUTER)
            .deployProxy(
                IKuruRouter.OrderBookType.NO_NATIVE,
                address(b),
                address(rq),
                SIZE_PRECISION,
                PRICE_PRECISION,
                TICK_SIZE,
                MIN_SIZE,
                MAX_SIZE,
                30,
                10,
                AMM_SPREAD
            );
        CovenantFactory f = new CovenantFactory(MARGIN);
        Terms memory t = _defaultTerms();
        t.market = mkt;
        t.baseToken = address(b);
        t.quoteToken = address(rq);
        vm.prank(issuer);
        CovenantVault v = CovenantVault(f.createMandate(t));

        b.mint(issuer, 1_000_000e18);
        rq.mint(issuer, 1_000_000e6);
        _accept(v);
        vm.startPrank(issuer);
        b.approve(address(v), 10_000e18);
        rq.approve(address(v), 10_000e6);
        v.depositInventory(address(b), 5_000e18);
        v.depositInventory(address(rq), 5_000e6);
        v.fundFees(1_000e6);
        v.activate();
        vm.stopPrank();

        // quote two-sided, accrue one passing interval
        vm.startPrank(mm);
        v.quote(_u32(BID_PX), _u96(QTY), _u32(ASK_PX), _u96(QTY), _empty40());
        vm.stopPrank();
        vm.warp(block.timestamp + 1);
        v.checkpoint();
        vm.warp(block.timestamp + CHECKPOINT);
        v.checkpoint();
        assertEq(v.accruedFees(), FEE_PER);

        // arm the reentrancy and claim — the re-entrant claimFees must revert the whole call.
        rq.arm(address(v));
        vm.prank(mm);
        vm.expectRevert(); // ReentrancyGuard: reentrant call
        v.claimFees();
    }
}
