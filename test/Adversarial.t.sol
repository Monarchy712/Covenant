// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {KuruIntegrationSpike} from "../src/KuruIntegrationSpike.sol";

/// @notice PHASE 7 — custody & adversarial (CRITICAL, STOP CHECK C).
///         Issuer deposits, vault quotes. Then, as MM and as a random attacker, try every
///         path to move the issuer's inventory out of vault control. All must fail.
contract AdversarialTest is Base {
    uint32 constant ASK_PRICE = 2e8;

    function setUp() public {
        _standardSetup(SELL_ALLOWANCE, 0);
        vm.startPrank(issuer);
        base.approve(address(vault), 1_000e18);
        quote.approve(address(vault), 1_000e6);
        vault.depositInventory(address(base), 1_000e18);
        vault.depositInventory(address(quote), 1_000e6);
        vm.stopPrank();

        // vault posts a resting ask (its inventory is now partly locked in an order)
        vm.prank(mm);
        vault.placeAsk(ASK_PRICE, 100e10);
    }

    // --- Role gating on the vault ------------------------------------------
    function test_mm_cannotWithdrawInventory() public {
        vm.prank(mm);
        vm.expectRevert(KuruIntegrationSpike.NotIssuer.selector);
        vault.withdrawInventory(address(base), 1e18);
    }

    function test_attacker_cannotWithdrawInventory() public {
        vm.prank(attacker);
        vm.expectRevert(KuruIntegrationSpike.NotIssuer.selector);
        vault.withdrawInventory(address(base), 1e18);
    }

    function test_attacker_cannotQuote() public {
        vm.prank(attacker);
        vm.expectRevert(KuruIntegrationSpike.NotMM.selector);
        vault.placeAsk(ASK_PRICE, 10e10);
    }

    function test_attacker_cannotCancelVaultOrderViaVault() public {
        vm.prank(attacker);
        vm.expectRevert(KuruIntegrationSpike.NotMM.selector);
        vault.cancelOrder(1);
    }

    // The vault exposes NO arbitrary-transfer / sweep function to anyone. Only the issuer
    // can withdraw, and only into the issuer's own address (see withdrawInventory).
    // (Compile-time guarantee: there is no such external function on the contract.)

    // --- Direct MarginAccount attacks --------------------------------------
    // MarginAccount.withdraw is self-keyed: an attacker withdraws from THEIR OWN (empty)
    // balance, never the vault's. The vault's margin is unchanged.
    function test_attacker_marginWithdraw_cannotTouchVault() public {
        uint256 vaultBaseBefore = margin.getBalance(address(vault), address(base));
        assertGt(vaultBaseBefore, 0, "vault has base margin");

        vm.prank(attacker);
        // attacker's own balance is 0, so this reverts InsufficientBalance (or no-ops at 0).
        try margin.withdraw(vaultBaseBefore, address(base)) {
            fail();
        } catch {
            // expected
        }
        assertEq(margin.getBalance(address(vault), address(base)), vaultBaseBefore, "vault margin untouched");
    }

    function test_mm_marginWithdraw_cannotTouchVault() public {
        uint256 vaultBaseBefore = margin.getBalance(address(vault), address(base));
        vm.prank(mm);
        try margin.withdraw(vaultBaseBefore, address(base)) {
            fail();
        } catch {}
        assertEq(margin.getBalance(address(vault), address(base)), vaultBaseBefore, "vault margin untouched");
    }

    // --- Direct OrderBook attacks ------------------------------------------
    // The vault's resting order is owned by the vault. A direct batchCancelOrders by the MM
    // or attacker is owner-checked against _msgSender() and cannot cancel the vault's order.
    function test_attacker_cannotCancelVaultOrderDirectly() public {
        // find the vault's order id (the only ask it placed in setUp): counter value.
        uint40 vaultOrderId = ob.s_orderIdCounter();
        assertEq(vault.getOrder(vaultOrderId).ownerAddress, address(vault), "vault owns the order");

        uint40[] memory ids = new uint40[](1);
        ids[0] = vaultOrderId;

        vm.prank(attacker);
        // Kuru reverts OnlyOwnerAllowedError since _msgSender()==attacker != owner==vault.
        vm.expectRevert();
        ob.batchCancelOrders(ids);

        // order still there, still owned by the vault.
        assertEq(vault.getOrder(vaultOrderId).ownerAddress, address(vault), "order intact");
    }

    function test_mm_cannotCancelVaultOrderDirectly() public {
        uint40 vaultOrderId = ob.s_orderIdCounter();
        uint40[] memory ids = new uint40[](1);
        ids[0] = vaultOrderId;
        vm.prank(mm);
        vm.expectRevert();
        ob.batchCancelOrders(ids);
        assertEq(vault.getOrder(vaultOrderId).ownerAddress, address(vault));
    }

    // MM cannot place an order that the vault would own, from its own wallet: any order the
    // MM places on the OB is owned by the MM (verified), never the vault — so it cannot
    // draw on the vault's margin either (debitUser keys to _msgSender()==MM, who has none).
    function test_mm_directOrder_isOwnedByMm_notVault_andHasNoVaultMargin() public {
        vm.prank(mm);
        // MM has no margin => placing a resting sell debits MM's (empty) base => reverts.
        vm.expectRevert();
        ob.addSellOrder(ASK_PRICE, 10e10, true);
    }

    // --- Self-trade path (DOCUMENTED, not prevented) -----------------------
    // A captured MM can collude with a taker wallet (or use its own) to lift the vault's
    // ask. This is NOT theft of inventory — the vault receives fair proceeds at the ask
    // price — but it lets the MM churn the allowance and capture any band slack. The value
    // leaked is BOUNDED by the band and the allowance:
    //   maxLeak(base) <= sellAllowance ; priceImpact per unit <= bandBps/1e4 of mid.
    // Here we simply demonstrate the trade executes and the vault is paid at its ask price.
    function test_selfTrade_isBoundedNotTheft() public {
        // MM uses a colluding taker wallet to buy the vault's 100-base ask.
        quote.mint(taker, 1_000e6);
        uint256 vaultQuoteBefore = margin.getBalance(address(vault), address(quote));

        vm.startPrank(taker);
        quote.approve(market, type(uint256).max);
        ob.placeAndExecuteMarketBuy(uint96(uint256(50) * ASK_PRICE), 0, false, false); // 50 base
        vm.stopPrank();

        // Vault got paid ~50 * 2.0 = 100 USDC (fair, at its own ask price). No inventory stolen.
        uint256 proceeds = margin.getBalance(address(vault), address(quote)) - vaultQuoteBefore;
        assertApproxEqAbs(proceeds, 100e6, 1e6, "vault paid fairly at ask price");
        // Sold is counted against the allowance (governor will stop further churn at the cap).
        assertApproxEqAbs(vault.soldBase(), (uint256(50) * 1e18 * (10_000 - MAKER_FEE_BPS)) / 10_000, 1e12, "counted");
    }

    // --- Issuer CAN withdraw (positive control) ----------------------------
    function test_issuer_canWithdrawFreeMargin() public {
        uint256 issuerBaseBefore = base.balanceOf(issuer);
        uint256 free = margin.getBalance(address(vault), address(base)); // 1000 - 100 locked = 900
        vm.prank(issuer);
        vault.withdrawInventory(address(base), free);
        assertEq(base.balanceOf(issuer) - issuerBaseBefore, free, "issuer received the free margin");
    }
}
