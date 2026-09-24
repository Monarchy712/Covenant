// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CovenantBase} from "./CovenantBase.t.sol";
import {CovenantFactory} from "../../src/covenant/CovenantFactory.sol";
import {CovenantVault} from "../../src/covenant/CovenantVault.sol";
import {Terms, State} from "../../src/covenant/CovenantTypes.sol";

/// @notice Suite 1 — Factory: create, validation reverts, registry views.
contract FactoryTest is CovenantBase {
    function setUp() public {
        _fork();
        _deployMarket();
        factory = new CovenantFactory(MARGIN);
    }

    function test_create_setsIssuerToCaller_andInitializes() public {
        vm.prank(issuer);
        address v = factory.createMandate(_defaultTerms());
        CovenantVault cv = CovenantVault(v);
        (,,, address termsIssuer,,,,,,,,,,,) = cv.terms();
        assertEq(termsIssuer, issuer, "issuer = caller");
        assertEq(uint256(cv.currentState()), uint256(State.CREATED));
        assertEq(address(cv.marginAccount()), MARGIN);
    }

    function test_registry() public {
        vm.startPrank(issuer);
        address v1 = factory.createMandate(_defaultTerms());
        address v2 = factory.createMandate(_defaultTerms());
        vm.stopPrank();
        assertEq(factory.totalMandates(), 2);
        assertEq(factory.mandatesOf(issuer).length, 2);
        assertEq(factory.mandatesForMM(mm).length, 2);
        address[] memory page = factory.allMandates(0, 1);
        assertEq(page.length, 1);
        assertEq(page[0], v1);
        assertEq(factory.allMandates(1, 10)[0], v2);
        assertEq(factory.allMandates(5, 10).length, 0, "offset past end");
    }

    function test_validation_zeroAddress() public {
        Terms memory t = _defaultTerms();
        t.mm = address(0);
        vm.prank(issuer);
        vm.expectRevert(CovenantFactory.ZeroAddress.selector);
        factory.createMandate(t);
    }

    function test_validation_marketMismatch() public {
        Terms memory t = _defaultTerms();
        t.baseToken = address(quote); // wrong base for this market
        vm.prank(issuer);
        vm.expectRevert();
        factory.createMandate(t);
    }

    function test_validation_bounds() public {
        vm.startPrank(issuer);
        Terms memory t = _defaultTerms();

        t.bandBps = 0;
        vm.expectRevert(abi.encodeWithSelector(CovenantFactory.BadBounds.selector, "bandBps"));
        factory.createMandate(t);

        t = _defaultTerms();
        t.maxOpenPerSide = 11;
        vm.expectRevert(abi.encodeWithSelector(CovenantFactory.BadBounds.selector, "maxOpenPerSide"));
        factory.createMandate(t);

        t = _defaultTerms();
        t.windowLength = 0;
        vm.expectRevert(abi.encodeWithSelector(CovenantFactory.BadBounds.selector, "windowLength"));
        factory.createMandate(t);

        t = _defaultTerms();
        t.duration = 0;
        vm.expectRevert(abi.encodeWithSelector(CovenantFactory.BadBounds.selector, "duration"));
        factory.createMandate(t);

        t = _defaultTerms();
        t.feePerInterval = 0;
        vm.expectRevert(abi.encodeWithSelector(CovenantFactory.BadBounds.selector, "feePerInterval"));
        factory.createMandate(t);
        vm.stopPrank();
    }
}
