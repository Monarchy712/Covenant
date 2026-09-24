// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CovenantBase} from "./CovenantBase.t.sol";
import {CovenantVault} from "../../src/covenant/CovenantVault.sol";
import {Snapshot, State} from "../../src/covenant/CovenantTypes.sol";

/// @notice Suite (P4) — snapshot() and previewQuote() power the dashboard + MM preflight.
contract ViewsTest is CovenantBase {
    function setUp() public {
        _setupActive();
        _quoteTwoSided();
    }

    function test_snapshot_reflectsState() public view {
        Snapshot memory s = vault.snapshot();
        assertEq(uint256(s.state), uint256(State.ACTIVE));
        assertEq(s.openOrders.length, 2, "1 bid + 1 ask");
        assertEq(s.baseMargin, margin.getBalance(address(vault), address(base)));
        assertEq(s.feeEscrow, 1_000e6);
        assertEq(s.terms.netSellCapPerWindow, NET_CAP);
        assertGt(s.remainingAllowance, 0);
    }

    function test_snapshot_afterFill() public {
        _takerBuy(30);
        vault.poke();
        Snapshot memory s = vault.snapshot();
        assertGt(s.soldBase, int256(0), "net sold positive");
        assertLt(s.remainingAllowance, NET_CAP, "allowance consumed");
    }

    function test_previewQuote_ok() public view {
        bytes4 sel = vault.previewQuote(_empty32(), _empty96(), _u32(ASK_PX), _u96(1e10), _empty40());
        assertEq(sel, bytes4(0), "in-band, under cap => OK");
    }

    function test_previewQuote_outOfBand() public view {
        bytes4 sel = vault.previewQuote(_empty32(), _empty96(), _u32(250_000_000), _u96(1e10), _empty40());
        assertEq(sel, CovenantVault.OutsideBand.selector, "preflight flags OutsideBand");
    }

    function test_previewQuote_overCap() public view {
        // resting ask 100 base + a 1000-base new ask => over the 1000 cap
        bytes4 sel = vault.previewQuote(_empty32(), _empty96(), _u32(ASK_PX), _u96(1000e10), _empty40());
        assertEq(sel, CovenantVault.SellAllowanceExceeded.selector, "preflight flags cap");
    }

    function test_previewQuote_matchesRealRevert() public {
        // preview says OutsideBand; the real call must revert.
        uint32 badPx = 250_000_000;
        bytes4 sel = vault.previewQuote(_empty32(), _empty96(), _u32(badPx), _u96(1e10), _empty40());
        assertEq(sel, CovenantVault.OutsideBand.selector);
        vm.prank(mm);
        vm.expectRevert();
        vault.quote(_empty32(), _empty96(), _u32(badPx), _u96(1e10), _empty40());
    }
}
