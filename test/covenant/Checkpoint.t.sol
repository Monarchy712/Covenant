// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CovenantBase} from "./CovenantBase.t.sol";
import {CovenantVault} from "../../src/covenant/CovenantVault.sol";

/// @notice Suite 6 — fail-dominant KPI checkpoint.
contract CheckpointTest is CovenantBase {
    function setUp() public {
        _setupActive();
    }

    /// @dev roll into the next interval and finalize the previous one.
    function _rollInterval() internal {
        vm.warp(block.timestamp + CHECKPOINT);
        vault.checkpoint();
    }

    function test_pass_accruesFee() public {
        _quoteTwoSided(); // tight two-sided (spread 50bps <= 100), depth 100 base
        vm.warp(block.timestamp + 1);
        vault.checkpoint(); // interval 0 observed pass
        _rollInterval(); // finalize interval 0
        assertEq(vault.accruedFees(), FEE_PER, "passing interval paid");
        assertEq(vault.consecutiveFails(), 0);
    }

    function test_fail_noAsk() public {
        _quoteTwoSided();
        // cancel the ask -> only a bid remains
        uint40 askId = vault.openAskIds(0);
        vm.prank(mm);
        vault.cancel(_u40(askId));
        vm.warp(block.timestamp + 1);
        vault.checkpoint(); // fail: no ask
        _rollInterval();
        assertEq(vault.accruedFees(), 0, "no-ask interval unpaid");
        assertEq(vault.consecutiveFails(), 1);
    }

    function test_fail_noBid() public {
        _quoteTwoSided();
        uint40 bidId = vault.openBidIds(0);
        vm.prank(mm);
        vault.cancel(_u40(bidId));
        vm.warp(block.timestamp + 1);
        vault.checkpoint();
        _rollInterval();
        assertEq(vault.accruedFees(), 0, "no-bid interval unpaid");
    }

    function test_fail_wideSpread() public {
        // bid 1.98 / ask 2.02 => spread 2% > maxSpread 1%, both within +/-2% band.
        _quote(198_000_000, QTY, 202_000_000, QTY);
        vm.warp(block.timestamp + 1);
        vault.checkpoint();
        _rollInterval();
        assertEq(vault.accruedFees(), 0, "wide-spread interval unpaid");
    }

    function test_fail_thinDepth() public {
        // tight prices but 0.5 base per side < minDepth (1 base)
        _quote(BID_PX, 5e9, ASK_PX, 5e9);
        vm.warp(block.timestamp + 1);
        vault.checkpoint();
        _rollInterval();
        assertEq(vault.accruedFees(), 0, "thin-depth interval unpaid");
    }

    function test_failDominance_passThenFailSameInterval_unpaid() public {
        _quoteTwoSided();
        vm.warp(block.timestamp + 1);
        vault.checkpoint(); // pass observation in interval 0
        // now break it within the SAME interval and observe again
        uint40 askId2 = vault.openAskIds(0);
        vm.prank(mm);
        vault.cancel(_u40(askId2));
        vault.checkpoint(); // fail observation in interval 0
        // MM tries to "fix" and observe pass again in the same interval
        _quote(BID_PX, QTY, ASK_PX, QTY); // re-adds an ask
        vault.checkpoint(); // pass again — but failed flag is sticky
        _rollInterval();
        assertEq(vault.accruedFees(), 0, "any fail in the interval => unpaid (fail-dominant)");
        assertEq(vault.consecutiveFails(), 1);
    }

    function test_unobservedInterval_unpaid() public {
        _quoteTwoSided();
        // no checkpoint in interval 0 or 1; jump to interval 3 and finalize.
        vm.warp(block.timestamp + 3 * CHECKPOINT);
        vault.checkpoint(); // finalizes 0,1,2 (all unobserved) then observes interval 3
        assertEq(vault.accruedFees(), 0, "unobserved intervals pay nothing");
        assertEq(vault.consecutiveFails(), 0, "unobserved is neutral, not a fail");
    }

    function test_paused_neitherPaidNorFailed() public {
        _quoteTwoSided();
        vm.prank(issuer);
        vault.pause();
        // checkpoint reverts while paused => interval gets no observation
        vm.warp(block.timestamp + 1);
        vm.expectRevert();
        vault.checkpoint();
        vm.prank(issuer);
        vault.unpause();
        // finalize the paused interval via rolling forward
        _rollInterval();
        assertEq(vault.consecutiveFails(), 0, "paused interval not a fail");
        assertEq(vault.accruedFees(), 0, "paused interval not paid");
    }

    function test_consecutiveFails_thenEarlyTerminate() public {
        _quoteTwoSided();
        uint40 askId3 = vault.openAskIds(0);
        vm.prank(mm);
        vault.cancel(_u40(askId3)); // break KPI (no ask)
        // observe a failing checkpoint in each of intervals 0..3 (absolute timestamps)
        uint256 t0 = block.timestamp;
        for (uint256 i = 0; i < 4; i++) {
            vm.warp(t0 + i * CHECKPOINT + 1);
            vault.checkpoint(); // fail obs in interval i
        }
        // roll past interval 3 to finalize 0..3
        vm.warp(t0 + 5 * CHECKPOINT);
        vault.checkpoint();
        assertGe(vault.consecutiveFails(), 3, "K consecutive fails");
        // issuer early-terminates; event flag afterKFails = true
        vm.prank(issuer);
        vault.terminate();
    }

    function test_lazyFinalize_acrossSkippedIntervals() public {
        _quoteTwoSided();
        vm.warp(block.timestamp + 1);
        vault.checkpoint(); // interval 0 pass
        // skip to interval 3 and finalize 0,1,2
        vm.warp(block.timestamp + 3 * CHECKPOINT);
        vault.checkpoint();
        // only interval 0 paid; 1 and 2 unobserved
        assertEq(vault.accruedFees(), FEE_PER, "only the observed passing interval paid");
    }
}
