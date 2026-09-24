// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MockERC20} from "../../../src/mocks/MockERC20.sol";

interface IClaimable {
    function claimFees() external;
}

/// @notice A 6-decimal ERC20 that, on transfer to a target, re-enters vault.claimFees() once.
///         Used to prove CovenantVault.claimFees is protected by ReentrancyGuard.
contract ReentrantQuote is MockERC20 {
    address public vault;
    bool public armed;

    constructor() MockERC20("Reentrant USDC", "rUSDC", 6) {}

    function arm(address _vault) external {
        vault = _vault;
        armed = true;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (armed && msg.sender == vault) {
            armed = false; // one-shot
            IClaimable(vault).claimFees(); // re-enter — must revert under ReentrancyGuard
        }
        return super.transfer(to, amount);
    }
}
