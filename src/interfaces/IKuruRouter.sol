// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IKuruRouter
/// @notice Minimal interface for the live Kuru Router, matching canonical source
///         Kuru-Labs/Kuru-contracts-dex-public@2060bb27 (contracts/Router.sol).
interface IKuruRouter {
    /// @dev OrderBookType: NO_NATIVE=0, NATIVE_IN_BASE=1, NATIVE_IN_QUOTE=2.
    enum OrderBookType {
        NO_NATIVE,
        NATIVE_IN_BASE,
        NATIVE_IN_QUOTE
    }

    /// @notice Deploys a new OrderBook market proxy and returns its address.
    /// @dev NOT `onlyOwner` in canonical source ⇒ open on testnet (confirmed by
    ///      monad-maize). The DEPLOYED mainnet Router gates this (Optara finding), so on
    ///      mainnet expect a revert unless called by the Router owner.
    function deployProxy(
        OrderBookType _type,
        address _baseAssetAddress,
        address _quoteAssetAddress,
        uint96 _sizePrecision,
        uint32 _pricePrecision,
        uint32 _tickSize,
        uint96 _minSize,
        uint96 _maxSize,
        uint256 _takerFeeBps,
        uint256 _makerFeeBps,
        uint96 _kuruAmmSpread
    ) external returns (address proxy);

    function orderBookImplementation() external view returns (address);
    function owner() external view returns (address);
}
