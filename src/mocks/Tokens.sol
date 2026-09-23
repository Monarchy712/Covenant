// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MockERC20} from "./MockERC20.sol";

/// @notice MockBase: 18-decimal base asset for the spike market.
contract MockBase is MockERC20 {
    constructor() MockERC20("Mock Base", "mBASE", 18) {}
}

/// @notice MockUSDC: 6-decimal quote asset for the spike market.
contract MockUSDC is MockERC20 {
    constructor() MockERC20("Mock USDC", "mUSDC", 6) {}
}
