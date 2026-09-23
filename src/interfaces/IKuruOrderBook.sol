// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IKuruOrderBook
/// @notice Minimal interface for a live Kuru OrderBook market, matching the CANONICAL
///         source at Kuru-Labs/Kuru-contracts-dex-public commit 2060bb27 (contracts/OrderBook.sol
///         and contracts/interfaces/IOrderBook.sol). Every deviation from docs.kuru.io is
///         commented with its evidence. See docs/KURU_ARCHITECTURE.md.
interface IKuruOrderBook {
    /// @dev OrderBook.Order. `size` is the REMAINING size (decremented on fills).
    ///      `ownerAddress` is set to `_msgSender()` at placement (OrderBook.sol:377),
    ///      i.e. the calling CONTRACT when called directly.
    struct Order {
        address ownerAddress;
        uint96 size;
        uint40 prev;
        uint40 next;
        uint40 flippedId;
        uint32 price;
        uint32 flippedPrice;
        bool isBuy;
    }

    // --- Placement -----------------------------------------------------------
    // EVIDENCE: docs say these return `uint40 orderId`. The REAL functions return
    // NOTHING (void). Declaring a return here makes the high-level call's ABI-decode
    // revert AFTER the order is already placed. Declared void to match reality; recover
    // the id from s_orderIdCounter() (see below), never from a return value.
    // `_price` is in pricePrecision units (uint32); `_size` is in sizePrecision units
    // (uint96). Resting orders debit the caller's MarginAccount balance, so a prior
    // MarginAccount.deposit() is required or this reverts InsufficientBalance() 0xf4d678b8.
    function addBuyOrder(uint32 _price, uint96 _size, bool _postOnly) external;
    function addSellOrder(uint32 _price, uint96 _size, bool _postOnly) external;

    /// @notice Atomic cancel-then-place. Cancels each id (owner-checked vs _msgSender()),
    ///         then places buys, then sells, all owned by _msgSender(). This is the
    ///         requoting primitive a CONTRACT uses directly — no EIP-7702 needed.
    function batchUpdate(
        uint32[] calldata buyPrices,
        uint96[] calldata buySizes,
        uint32[] calldata sellPrices,
        uint96[] calldata sellSizes,
        uint40[] calldata orderIdsToCancel,
        bool postOnly
    ) external;

    function batchCancelOrders(uint40[] calldata _orderIds) external;

    // --- Taker (used by the TAKER wallet in fill tests) ----------------------
    // EVIDENCE: `_minAmountOut` is uint256, NOT uint96 — a uint96 guess changes the
    // selector and every call routes to nothing and reverts with 0 bytes.
    function placeAndExecuteMarketBuy(uint96 _quoteAmount, uint256 _minAmountOut, bool _isMargin, bool _isFillOrKill)
        external
        payable
        returns (uint256);
    function placeAndExecuteMarketSell(uint96 _size, uint256 _minAmountOut, bool _isMargin, bool _isFillOrKill)
        external
        payable
        returns (uint256);

    // --- Views ---------------------------------------------------------------
    /// @notice Monotonic order-id counter. New order id == value read immediately AFTER
    ///         placement (== value before + 1 for a single order). Basis of on-chain
    ///         order-id recovery.
    function s_orderIdCounter() external view returns (uint40);

    /// @notice Public getter for the s_orders mapping. Returns the Order fields as a tuple.
    function s_orders(uint40 orderId)
        external
        view
        returns (
            address ownerAddress,
            uint96 size,
            uint40 prev,
            uint40 next,
            uint40 flippedId,
            uint32 price,
            uint32 flippedPrice,
            bool isBuy
        );

    // EVIDENCE: returns (uint256,uint256), NOT (uint32,uint32). "No bid"/"no ask"
    // sentinel is type(uint256).max. A uint32 guess reverts decoding the sentinel.
    function bestBidAsk() external view returns (uint256 bestBid, uint256 bestAsk);

    function getL2Book() external view returns (bytes memory);

    /// @notice (pricePrecision, sizePrecision, base, baseDec, quote, quoteDec, tickSize,
    ///          minSize, maxSize, takerFeeBps, makerFeeBps)
    function getMarketParams()
        external
        view
        returns (uint32, uint96, address, uint256, address, uint256, uint32, uint96, uint96, uint256, uint256);

    // --- Events (indexed off-chain only; NOT readable on-chain) --------------
    event OrderCreated(uint40 orderId, address owner, uint96 size, uint32 price, bool isBuy);
    event OrdersCanceled(uint40[] orderId, address owner);
    // isBuy = TAKER direction; price emitted at 18-decimal scale.
    event Trade(
        uint40 orderId,
        address makerAddress,
        bool isBuy,
        uint256 price,
        uint96 updatedSize,
        address takerAddress,
        address txOrigin,
        uint96 filledSize
    );
}
