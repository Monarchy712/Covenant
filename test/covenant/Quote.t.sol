// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CovenantBase} from "./CovenantBase.t.sol";
import {CovenantVault} from "../../src/covenant/CovenantVault.sol";

/// @notice Suite 4 — quote: place, replace via batchUpdate, band, open-order cap, margin.
contract QuoteTest is CovenantBase {
    function setUp() public {
        _setupActive();
    }

    function test_place_twoSided_bootstrapEmptyBook() public {
        _quoteTwoSided();
        assertEq(vault.openBidCount(), 1);
        assertEq(vault.openAskCount(), 1);
    }

    function test_place_oneSidedIntoEmptyBook_reverts() public {
        // only an ask into an empty book => EmptyBook (no reference mid)
        vm.prank(mm);
        vm.expectRevert(CovenantVault.EmptyBook.selector);
        vault.quote(_empty32(), _empty96(), _u32(ASK_PX), _u96(QTY), _empty40());
    }

    function test_replace_viaBatchUpdate() public {
        _quoteTwoSided();
        // now the book has a mid; cancel the ask and place a new one one tick up.
        // find the ask id: it's the second placed order. We read from snapshot.
        uint40 askId = _askId();
        uint32[] memory none32 = _empty32();
        uint96[] memory none96 = _empty96();
        vm.prank(mm);
        vault.quote(none32, none96, _u32(ASK_PX + TICK_SIZE), _u96(QTY), _u40(askId));
        assertEq(vault.openAskCount(), 1, "still one ask after replace");
    }

    function test_band_invalid_reverts() public {
        _quoteTwoSided(); // establishes mid ~2.0
        // ask way above band (2.5 = +25%)
        vm.prank(mm);
        vm.expectRevert();
        vault.quote(_empty32(), _empty96(), _u32(250_000_000), _u96(QTY), _empty40());
    }

    function test_band_boundary_ok() public {
        _quoteTwoSided(); // mid 2.0
        // upper bound = 2.0 * 1.02 = 2.04 => 204_000_000 (multiple of tick)
        vm.prank(mm);
        vault.quote(_empty32(), _empty96(), _u32(204_000_000), _u96(QTY), _empty40());
        assertEq(vault.openAskCount(), 2);
    }

    function test_openOrderCap_boundary() public {
        // maxOpenPerSide = 5. Place 5 asks (bootstrapping needs a bid too on first call).
        _quoteTwoSided(); // 1 bid, 1 ask
        // add asks until 5 total; each within band.
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(mm);
            vault.quote(_empty32(), _empty96(), _u32(uint32(ASK_PX + uint32(i) * TICK_SIZE)), _u96(1e10), _empty40());
        }
        assertEq(vault.openAskCount(), 5);
        // the 6th ask exceeds the cap
        vm.prank(mm);
        vm.expectRevert(abi.encodeWithSelector(CovenantVault.TooManyOpenOrders.selector, false, uint256(6), MAX_OPEN));
        vault.quote(_empty32(), _empty96(), _u32(ASK_PX), _u96(1e10), _empty40());
    }

    function test_insufficientMargin_surfacesKuruRevert() public {
        // Try to place an ask far larger than the vault's base margin (5000 base).
        _quoteTwoSided();
        vm.prank(mm);
        vm.expectRevert(); // Kuru MarginAccount InsufficientBalance bubbles up
        vault.quote(_empty32(), _empty96(), _u32(ASK_PX), _u96(1_000_000e10), _empty40());
    }

    function test_lengthMismatch_reverts() public {
        uint32[] memory p = new uint32[](2);
        uint96[] memory s = new uint96[](1);
        vm.prank(mm);
        vm.expectRevert(CovenantVault.LengthMismatch.selector);
        vault.quote(p, s, _empty32(), _empty96(), _empty40());
    }

    function _askId() internal view returns (uint40) {
        // openAskIds[0]
        return vault.openAskIds(0);
    }
}
