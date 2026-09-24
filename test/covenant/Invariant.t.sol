// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CovenantBase} from "./CovenantBase.t.sol";
import {Handler} from "./Handler.sol";

/// @notice Suite 10 — handler-based invariants over random action sequences.
contract InvariantCovenantTest is CovenantBase {
    Handler handler;

    function setUp() public {
        _setupActive();
        handler = new Handler(vault, ob, base, quote, mm, taker, issuer);

        // route fuzzing to the handler only
        bytes4[] memory sels = new bytes4[](8);
        sels[0] = Handler.doQuote.selector;
        sels[1] = Handler.cancelFirstAsk.selector;
        sels[2] = Handler.takerBuy.selector;
        sels[3] = Handler.takerSell.selector;
        sels[4] = Handler.doCheckpoint.selector;
        sels[5] = Handler.doClaim.selector;
        sels[6] = Handler.warp.selector;
        sels[7] = Handler.pauseToggle.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
        targetContract(address(handler));
    }

    /// MM never gains base, and gains quote ONLY via claimed fees.
    function invariant_mmNeverGainsInventory() public view {
        assertEq(base.balanceOf(mm), 0, "MM holds no base");
        assertEq(quote.balanceOf(mm), handler.mmClaimedTotal(), "MM quote == claimed fees only");
    }

    /// Accrued fees never exceed the escrow.
    function invariant_accruedWithinEscrow() public view {
        assertLe(vault.accruedFees(), vault.feeEscrow(), "accrued <= escrow");
        assertLe(vault.claimedFees(), vault.accruedFees(), "claimed <= accrued");
    }

    /// Open orders per side never exceed the cap.
    function invariant_openOrdersWithinCap() public view {
        assertLe(vault.openBidCount(), MAX_OPEN, "bids <= max");
        assertLe(vault.openAskCount(), MAX_OPEN, "asks <= max");
    }

    /// Net sold in the (poked) window never exceeds the cap plus a bounded drift tolerance.
    /// warp() always pokes, so drift stays within one action's fillable size (<= ~50 base).
    function invariant_netSoldWithinCap() public view {
        int256 net = vault.netSoldInWindow();
        int256 driftTol = int256(uint256(51e18)); // one max quote (50 base) + rounding
        assertLe(net, int256(NET_CAP) + driftTol, "netSold <= cap + drift");
    }
}
