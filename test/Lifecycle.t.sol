// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {IKuruOrderBook} from "../src/interfaces/IKuruOrderBook.sol";

/// @notice PHASE 3 — contract-owned lifecycle (CRITICAL, STOP CHECK A).
///         The VAULT CONTRACT itself performs every action and owns everything.
contract LifecycleTest is Base {
    uint32 constant ASK_PRICE = 2e8; // 2.0 quote/base (multiple of tick=100)
    uint32 constant BID_PRICE = 1e8; // 1.0 quote/base
    uint96 constant ASK_SIZE = 100e10; // 100 base (size units = base * sizePrecision)
    uint96 constant BID_SIZE = 100e10;

    function setUp() public {
        _standardSetup(
            SELL_ALLOWANCE,
            0 /* band off */
        );
        // Issuer deposits inventory into the vault's OWN MarginAccount balance.
        vm.startPrank(issuer);
        base.approve(address(vault), 500e18);
        quote.approve(address(vault), 500e6);
        vault.depositInventory(address(base), 500e18);
        vault.depositInventory(address(quote), 500e6);
        vm.stopPrank();
    }

    // 3.1-3.2: deposit into MarginAccount on the vault's own behalf.
    function test_depositCreditsVaultMargin() public view {
        assertEq(margin.getBalance(address(vault), address(base)), 500e18, "base margin keyed to vault");
        assertEq(margin.getBalance(address(vault), address(quote)), 500e6, "quote margin keyed to vault");
        // MM owns nothing.
        assertEq(margin.getBalance(mm, address(base)), 0, "mm has no base margin");
    }

    // 3.3-3.4: place a post-only ask and recover the id ON-CHAIN in the same tx.
    function test_placeAsk_recoverId() public {
        vm.prank(mm);
        uint40 id = vault.placeAsk(ASK_PRICE, ASK_SIZE);
        assertGt(id, 0, "recovered a non-zero order id");
        assertEq(vault.openAskCount(), 1);

        // 3.5: read the order state — owner == vault.
        IKuruOrderBook.Order memory o = vault.getOrder(id);
        assertEq(o.ownerAddress, address(vault), "order owner is the VAULT");
        assertEq(o.price, ASK_PRICE, "price");
        assertEq(o.size, ASK_SIZE, "remaining size == full size (unfilled)");
        assertEq(o.isBuy, false, "isBuy=false => ask");
    }

    // Ownership proof: the MM EOA owns nothing; the vault owns the order + margin.
    function test_ownership_mmOwnsNothing() public {
        vm.prank(mm);
        uint40 id = vault.placeAsk(ASK_PRICE, ASK_SIZE);
        IKuruOrderBook.Order memory o = vault.getOrder(id);
        assertEq(o.ownerAddress, address(vault));
        assertTrue(o.ownerAddress != mm, "MM does not own the order");
        assertEq(margin.getBalance(mm, address(base)), 0);
        assertEq(margin.getBalance(mm, address(quote)), 0);
    }

    // Place a post-only bid too.
    function test_placeBid_recoverId() public {
        vm.prank(mm);
        uint40 id = vault.placeBid(BID_PRICE, BID_SIZE);
        IKuruOrderBook.Order memory o = vault.getOrder(id);
        assertEq(o.ownerAddress, address(vault));
        assertEq(o.isBuy, true, "bid");
    }

    // 3.6: cancel a resting order; margin is credited back.
    function test_cancel() public {
        uint256 marginBefore = margin.getBalance(address(vault), address(base));
        vm.prank(mm);
        uint40 id = vault.placeAsk(ASK_PRICE, ASK_SIZE);
        assertLt(margin.getBalance(address(vault), address(base)), marginBefore, "ask locked base out of margin");

        vm.prank(mm);
        vault.cancelOrder(id);
        assertEq(vault.openAskCount(), 0, "removed from tracking");
        assertEq(margin.getBalance(address(vault), address(base)), marginBefore, "cancel re-credited base margin");

        // order is gone (owner zeroed)
        IKuruOrderBook.Order memory o = vault.getOrder(id);
        assertEq(o.ownerAddress, address(0), "order deleted on cancel");
    }

    // 3.7-3.8: atomic cancel+replace in ONE batchUpdate call by the contract.
    function test_replaceAtomic() public {
        vm.prank(mm);
        uint40 id1 = vault.placeAsk(ASK_PRICE, ASK_SIZE);

        vm.prank(mm);
        uint40 id2 = vault.replaceAskAtomic(id1, ASK_PRICE + TICK_SIZE, ASK_SIZE);

        assertGt(id2, id1, "new id is a fresh, higher counter value");
        assertEq(vault.openAskCount(), 1, "still exactly one open ask");

        IKuruOrderBook.Order memory oldOrder = vault.getOrder(id1);
        assertEq(oldOrder.ownerAddress, address(0), "old order cancelled");
        IKuruOrderBook.Order memory newOrder = vault.getOrder(id2);
        assertEq(newOrder.ownerAddress, address(vault), "new order owned by vault");
        assertEq(newOrder.price, ASK_PRICE + TICK_SIZE, "new price");
    }

    // Order-id recovery under CONCURRENT third-party orders.
    // A different account (taker) places its own order between two vault placements;
    // the vault must still recover the correct id for its own order.
    function test_orderId_underConcurrentThirdParty() public {
        // Give the taker its own inventory + margin so it can place a resting bid.
        quote.mint(taker, 1_000e6);
        vm.startPrank(taker);
        quote.approve(MARGIN, 1_000e6);
        margin.deposit(taker, address(quote), 1_000e6);
        vm.stopPrank();

        // Vault places ask #1.
        vm.prank(mm);
        uint40 vaultId1 = vault.placeAsk(ASK_PRICE, ASK_SIZE);

        // Third party places a bid (consumes a counter value between the vault's orders).
        vm.prank(taker);
        ob.addBuyOrder(BID_PRICE, 10e10, true);
        uint40 takerId = ob.s_orderIdCounter();

        // Vault places ask #2.
        vm.prank(mm);
        uint40 vaultId2 = vault.placeAsk(ASK_PRICE, ASK_SIZE);

        // Each recovered id maps to the right owner — no confusion despite interleaving.
        assertEq(vault.getOrder(vaultId1).ownerAddress, address(vault), "vault owns id1");
        assertEq(vault.getOrder(takerId).ownerAddress, taker, "taker owns its own id");
        assertEq(vault.getOrder(vaultId2).ownerAddress, address(vault), "vault owns id2");
        assertTrue(vaultId1 != takerId && vaultId2 != takerId, "ids are distinct");
        assertEq(takerId, vaultId1 + 1, "counter is strictly monotonic across accounts");
        assertEq(vaultId2, takerId + 1, "vault's second id follows the third party's");
    }
}
