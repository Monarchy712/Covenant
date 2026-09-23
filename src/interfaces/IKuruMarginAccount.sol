// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IKuruMarginAccount
/// @notice Minimal interface for the live Kuru MarginAccount, matching canonical source
///         Kuru-Labs/Kuru-contracts-dex-public commit 2060bb27 (contracts/MarginAccount.sol).
///         balances are keyed by keccak256(abi.encodePacked(user, token)).
interface IKuruMarginAccount {
    /// @notice Credits balances[key(_user, _token)] by _amount, pulling _amount from the
    ///         CALLER (_msgSender()). A vault calls deposit(address(this), token, amt) to
    ///         fund its OWN margin from its own token balance (approve first).
    ///         Native (address(0)) requires msg.value == _amount.
    function deposit(address _user, address _token, uint256 _amount) external payable;

    /// @notice Withdraws from balances[key(_msgSender(), _token)] ONLY — strictly self-keyed.
    ///         An MM/attacker calling this can never touch another account's balance.
    function withdraw(uint256 _amount, address _token) external;

    /// @notice balances[key(_user, _token)] — the free (unlocked) margin.
    function getBalance(address _user, address _token) external view returns (uint256);

    /// @notice Raw balances mapping getter (key = keccak256(abi.encodePacked(user, token))).
    function balances(bytes32 key) external view returns (uint256);

    /// @notice True if `market` is a Kuru-verified OrderBook. Only verified markets may
    ///         call debitUser/creditUser to move margin.
    function verifiedMarket(address market) external view returns (bool);
}
