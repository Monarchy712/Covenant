// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CovenantBase} from "./CovenantBase.t.sol";
import {CovenantFactory} from "../../src/covenant/CovenantFactory.sol";
import {CovenantVault} from "../../src/covenant/CovenantVault.sol";
import {Terms, State} from "../../src/covenant/CovenantTypes.sol";

/// @notice Step-0 decision: accept(termsHash) binds the MM only to the terms it reviewed.
contract TermsHashTest is CovenantBase {
    function _fresh() internal returns (CovenantVault v) {
        _fork();
        _deployMarket();
        factory = new CovenantFactory(MARGIN);
        v = _createMandate(_defaultTerms());
    }

    function test_accept_withCorrectHash() public {
        CovenantVault v = _fresh();
        bytes32 h = v.termsHash();
        vm.prank(mm);
        v.accept(h);
        assertEq(uint256(v.currentState()), uint256(State.ACCEPTED));
    }

    function test_accept_afterEdit_reverts() public {
        CovenantVault v = _fresh();
        bytes32 stale = v.termsHash(); // MM reviewed this

        // issuer edits terms in CREATED -> hash changes
        Terms memory t = _defaultTerms();
        t.issuer = issuer;
        t.bandBps = 300;
        vm.prank(issuer);
        v.updateTerms(t);

        bytes32 nowHash = v.termsHash();
        assertTrue(nowHash != stale, "hash changed on edit");
        vm.prank(mm);
        vm.expectRevert(abi.encodeWithSelector(CovenantVault.TermsMismatch.selector, stale, nowHash));
        v.accept(stale);
    }

    /// The edit and the acceptance land in the SAME block: the edit still changes the hash,
    /// so the stale acceptance reverts regardless of ordering within the block.
    function test_accept_frontRunEditSameBlock_reverts() public {
        CovenantVault v = _fresh();
        bytes32 stale = v.termsHash();

        Terms memory t = _defaultTerms();
        t.issuer = issuer;
        t.maxSpreadBps = 250;
        // same block: no vm.roll/warp between the edit and the accept
        vm.prank(issuer);
        v.updateTerms(t);
        bytes32 nowHash = v.termsHash();
        vm.prank(mm);
        vm.expectRevert(abi.encodeWithSelector(CovenantVault.TermsMismatch.selector, stale, nowHash));
        v.accept(stale);
    }

    function test_accept_withNewHashAfterEdit_ok() public {
        CovenantVault v = _fresh();
        Terms memory t = _defaultTerms();
        t.issuer = issuer;
        t.bandBps = 300;
        vm.prank(issuer);
        v.updateTerms(t);
        // MM re-reads and accepts the new hash
        bytes32 h = v.termsHash();
        vm.prank(mm);
        v.accept(h);
        assertEq(uint256(v.currentState()), uint256(State.ACCEPTED));
    }
}
