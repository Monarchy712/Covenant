// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CovenantVault} from "./CovenantVault.sol";
import {Terms} from "./CovenantTypes.sol";
import {IKuruOrderBook} from "../interfaces/IKuruOrderBook.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

/// @title CovenantFactory
/// @notice Deploys one CovenantVault per mandate as an EIP-1167 minimal-proxy CLONE of a single
///         implementation. Clones are chosen over `new` so the factory's own runtime bytecode
///         stays tiny (a `new CovenantVault(...)` would embed the full vault initcode into the
///         factory and risk the 24KB limit). Keeps per-issuer / per-MM registries for the app.
contract CovenantFactory {
    address public immutable implementation;
    address public immutable marginAccount;

    address[] public allMandatesList;
    mapping(address => address[]) internal _byIssuer;
    mapping(address => address[]) internal _byMM;

    event MandateCreated(address indexed vault, address indexed issuer, address indexed mm, address market);

    error ZeroAddress();
    error BadBounds(string what);
    error MarketAssetMismatch();

    constructor(address margin) {
        if (margin == address(0)) revert ZeroAddress();
        marginAccount = margin;
        implementation = address(new CovenantVault());
    }

    /// @notice Deploy + initialize a CovenantVault for `terms`, with msg.sender as the issuer.
    function createMandate(Terms calldata terms) external returns (address vault) {
        _validate(terms);

        Terms memory t = terms;
        t.issuer = msg.sender; // issuer is always the caller

        vault = Clones.clone(implementation);
        CovenantVault(vault).initialize(t, marginAccount);

        allMandatesList.push(vault);
        _byIssuer[msg.sender].push(vault);
        _byMM[t.mm].push(vault);

        emit MandateCreated(vault, msg.sender, t.mm, t.market);
    }

    /// @dev Validate terms: nonzero addresses, market base/quote match, sane numeric bounds.
    function _validate(Terms calldata t) internal view {
        if (t.market == address(0) || t.baseToken == address(0) || t.quoteToken == address(0) || t.mm == address(0)) {
            revert ZeroAddress();
        }
        if (t.baseToken == t.quoteToken) revert BadBounds("base==quote");

        (,, address mktBase,, address mktQuote,,,,,,) = IKuruOrderBook(t.market).getMarketParams();
        if (mktBase != t.baseToken || mktQuote != t.quoteToken) revert MarketAssetMismatch();

        if (t.bandBps == 0 || t.bandBps > 5_000) revert BadBounds("bandBps"); // (0, 50%]
        if (t.maxSpreadBps == 0 || t.maxSpreadBps > 5_000) revert BadBounds("maxSpreadBps");
        if (t.windowLength == 0) revert BadBounds("windowLength");
        if (t.checkpointInterval == 0) revert BadBounds("checkpointInterval");
        if (t.maxOpenPerSide < 1 || t.maxOpenPerSide > 10) revert BadBounds("maxOpenPerSide");
        if (t.duration == 0) revert BadBounds("duration");
        if (t.netSellCapPerWindow == 0) revert BadBounds("netSellCapPerWindow");
        if (t.feePerInterval == 0) revert BadBounds("feePerInterval");
        if (t.maxConsecutiveFails == 0) revert BadBounds("maxConsecutiveFails");
    }

    // --- Registry views ------------------------------------------------------
    function mandatesOf(address issuer) external view returns (address[] memory) {
        return _byIssuer[issuer];
    }

    function mandatesForMM(address mm) external view returns (address[] memory) {
        return _byMM[mm];
    }

    function totalMandates() external view returns (uint256) {
        return allMandatesList.length;
    }

    function allMandates(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        uint256 n = allMandatesList.length;
        if (offset >= n) return new address[](0);
        uint256 end = offset + limit;
        if (end > n) end = n;
        page = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = allMandatesList[i];
        }
    }
}
