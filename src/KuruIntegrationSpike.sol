// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IKuruOrderBook} from "./interfaces/IKuruOrderBook.sol";
import {IKuruMarginAccount} from "./interfaces/IKuruMarginAccount.sol";

interface IERC20Min {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
}

/// @title KuruIntegrationSpike
/// @notice A smart-contract "Covenant Vault" that owns a Kuru market-making position
///         directly (no EOA, no EIP-7702). It:
///           - holds inventory and deposits into MarginAccount on its OWN behalf,
///           - places/cancels/replaces post-only Kuru orders as their owner,
///           - recovers each new order id ON-CHAIN via s_orderIdCounter,
///           - reads its own order state (owner/side/price/remaining size),
///           - computes its own sold-base amount from on-chain state,
///           - enforces a sell allowance and a price band ATOMICALLY inside quote().
///
///         Ownership works because Kuru's OrderBook/MarginAccount key everything to
///         ERC2771 `_msgSender()`, which for a direct contract call == address(this).
///         See docs/KURU_ARCHITECTURE.md for the source evidence.
contract KuruIntegrationSpike {
    // --- Roles ---------------------------------------------------------------
    address public immutable issuer; // deposits inventory, can withdraw
    address public immutable mm; // operator, may only quote/cancel through the vault

    // --- Kuru wiring ---------------------------------------------------------
    IKuruOrderBook public immutable orderBook;
    IKuruMarginAccount public immutable marginAccount;
    address public immutable base; // 18-dec base asset
    address public immutable quote; // 6-dec quote asset

    // cached market precisions (read once from getMarketParams)
    uint256 public immutable sizePrecision;
    uint256 public immutable pricePrecision;
    uint256 public immutable baseMult; // 10**baseDecimals
    uint256 public immutable quoteMult; // 10**quoteDecimals

    // --- Mandate parameters --------------------------------------------------
    uint256 public sellAllowanceBase; // max cumulative base that may be exposed to sale (raw base units)
    uint256 public bandBps; // price band half-width around mid, in bps (e.g. 500 = ±5%)

    // --- Accounting ----------------------------------------------------------
    uint256 public baseDepositedCumulative; // raw base tokens ever deposited to margin by this vault
    uint256 public quoteDepositedCumulative; // raw quote tokens ever deposited to margin by this vault
    uint40[] public openAskIds; // ids of this vault's resting asks
    uint40[] public openBidIds; // ids of this vault's resting bids

    // --- Events --------------------------------------------------------------
    event InventoryDeposited(address indexed token, uint256 rawAmount, uint256 cumulative);
    event InventoryWithdrawn(address indexed token, uint256 rawAmount);
    event AskPlaced(uint40 indexed orderId, uint32 price, uint96 size);
    event BidPlaced(uint40 indexed orderId, uint32 price, uint96 size);
    event OrderCancelled(uint40 indexed orderId);
    event AskReplaced(uint40 indexed cancelledId, uint40 indexed newId, uint32 price, uint96 size);
    event MandateUpdated(uint256 sellAllowanceBase, uint256 bandBps);

    // --- Errors --------------------------------------------------------------
    error NotIssuer();
    error NotMM();
    error SellAllowanceExceeded(uint256 sold, uint256 resting, uint256 requested, uint256 allowance);
    error PriceOutOfBand(uint256 price, uint256 lo, uint256 hi);
    error EmptyBook();
    error MarketAssetMismatch();

    modifier onlyIssuer() {
        if (msg.sender != issuer) revert NotIssuer();
        _;
    }

    modifier onlyMM() {
        if (msg.sender != mm) revert NotMM();
        _;
    }

    constructor(
        address _orderBook,
        address _marginAccount,
        address _base,
        address _quote,
        address _issuer,
        address _mm,
        uint256 _sellAllowanceBase,
        uint256 _bandBps
    ) {
        orderBook = IKuruOrderBook(_orderBook);
        marginAccount = IKuruMarginAccount(_marginAccount);
        base = _base;
        quote = _quote;
        issuer = _issuer;
        mm = _mm;
        sellAllowanceBase = _sellAllowanceBase;
        bandBps = _bandBps;

        (
            uint32 _pp,
            uint96 _sp,
            address _mktBase,
            uint256 _baseDec,
            address _mktQuote,
            uint256 _quoteDec,, // tickSize
            , // minSize
            , // maxSize
            , // takerFeeBps
            // makerFeeBps
        ) = IKuruOrderBook(_orderBook).getMarketParams();
        if (_mktBase != _base || _mktQuote != _quote) revert MarketAssetMismatch();
        pricePrecision = _pp;
        sizePrecision = _sp;
        baseMult = 10 ** _baseDec;
        quoteMult = 10 ** _quoteDec;
    }

    // =========================================================================
    // Custody: deposit / withdraw (Phase 3.1-3.2, Phase 7)
    // =========================================================================

    /// @notice Issuer funds the vault's OWN MarginAccount balance. Tokens are pulled from
    ///         the issuer (approve first), then deposited under key(address(this), token).
    function depositInventory(address token, uint256 rawAmount) external onlyIssuer {
        IERC20Min(token).transferFrom(msg.sender, address(this), rawAmount);
        IERC20Min(token).approve(address(marginAccount), rawAmount);
        marginAccount.deposit(address(this), token, rawAmount);
        if (token == base) baseDepositedCumulative += rawAmount;
        if (token == quote) quoteDepositedCumulative += rawAmount;
        emit InventoryDeposited(token, rawAmount, token == base ? baseDepositedCumulative : quoteDepositedCumulative);
    }

    /// @notice Only the issuer can pull inventory back out of the vault. Because
    ///         MarginAccount.withdraw is self-keyed to _msgSender()==this vault, the
    ///         funds land here, then are forwarded to the issuer.
    function withdrawInventory(address token, uint256 rawAmount) external onlyIssuer {
        marginAccount.withdraw(rawAmount, token);
        IERC20Min(token).transfer(issuer, rawAmount);
        emit InventoryWithdrawn(token, rawAmount);
    }

    // =========================================================================
    // Quoting: place / cancel / replace (Phase 3.3-3.8)
    // =========================================================================

    /// @notice Place a post-only ask, enforcing the sell governor and price band in the
    ///         SAME tx, and recover the new order id on-chain.
    function placeAsk(uint32 price, uint96 size) external onlyMM returns (uint40 orderId) {
        _checkSellAllowance(size);
        _checkBand(price);
        orderBook.addSellOrder(price, size, true); // post-only
        orderId = orderBook.s_orderIdCounter(); // monotonic counter => id of the order just placed
        openAskIds.push(orderId);
        emit AskPlaced(orderId, price, size);
    }

    /// @notice Place a post-only bid, enforcing the price band.
    function placeBid(uint32 price, uint96 size) external onlyMM returns (uint40 orderId) {
        _checkBand(price);
        orderBook.addBuyOrder(price, size, true);
        orderId = orderBook.s_orderIdCounter();
        openBidIds.push(orderId);
        emit BidPlaced(orderId, price, size);
    }

    /// @notice Cancel one of the vault's resting orders.
    function cancelOrder(uint40 orderId) external onlyMM {
        uint40[] memory ids = new uint40[](1);
        ids[0] = orderId;
        orderBook.batchCancelOrders(ids);
        _removeOpen(orderId);
        emit OrderCancelled(orderId);
    }

    /// @notice Atomic cancel+replace of an ask via a single OrderBook.batchUpdate call
    ///         made directly by this contract (the requoting primitive; no EIP-7702).
    function replaceAskAtomic(uint40 cancelId, uint32 newPrice, uint96 newSize) external onlyMM returns (uint40 newId) {
        _checkSellAllowance(newSize);
        _checkBand(newPrice);

        uint32[] memory empty32 = new uint32[](0);
        uint96[] memory empty96 = new uint96[](0);
        uint32[] memory sellPrices = new uint32[](1);
        uint96[] memory sellSizes = new uint96[](1);
        uint40[] memory cancels = new uint40[](1);
        sellPrices[0] = newPrice;
        sellSizes[0] = newSize;
        cancels[0] = cancelId;

        orderBook.batchUpdate(empty32, empty96, sellPrices, sellSizes, cancels, true);

        newId = orderBook.s_orderIdCounter();
        _removeOpen(cancelId);
        openAskIds.push(newId);
        emit AskReplaced(cancelId, newId, newPrice, newSize);
    }

    // =========================================================================
    // On-chain order & fill state (Phase 3.5, Phase 4)
    // =========================================================================

    /// @notice Full order state as stored by Kuru (owner/side/price/remaining size).
    function getOrder(uint40 orderId) external view returns (IKuruOrderBook.Order memory o) {
        (o.ownerAddress, o.size, o.prev, o.next, o.flippedId, o.price, o.flippedPrice, o.isBuy) =
            orderBook.s_orders(orderId);
    }

    /// @notice Base (raw token units) currently locked across this vault's resting asks.
    function restingAskBaseRaw() public view returns (uint256 total) {
        uint256 n = openAskIds.length;
        for (uint256 i = 0; i < n; i++) {
            (address owner, uint96 sz,,,,,,) = orderBook.s_orders(openAskIds[i]);
            if (owner == address(this)) {
                total += (uint256(sz) * baseMult) / sizePrecision;
            }
        }
    }

    /// @notice Base (raw token units) this vault has SOLD, derived purely from on-chain
    ///         state:  sold = deposited - freeMargin - lockedInAsks.
    ///         Exact on the base side (base carries no maker fee; only sizePrecision
    ///         integer-rounding, bounded < 1 sizePrecision tick per open ask).
    function soldBase() public view returns (uint256) {
        uint256 freeMargin = marginAccount.getBalance(address(this), base);
        uint256 locked = restingAskBaseRaw();
        uint256 accountedFor = freeMargin + locked;
        if (accountedFor >= baseDepositedCumulative) return 0;
        return baseDepositedCumulative - accountedFor;
    }

    function openAskCount() external view returns (uint256) {
        return openAskIds.length;
    }

    function openBidCount() external view returns (uint256) {
        return openBidIds.length;
    }

    // =========================================================================
    // Enforcement (Phase 5 governor, Phase 6 band)
    // =========================================================================

    /// @notice Governor: sold + resting + new > allowance  => revert.
    ///         `sold` comes from the Phase-4 on-chain formula, not internal bookkeeping.
    function _checkSellAllowance(uint96 newSizeSp) internal view {
        uint256 sold = soldBase();
        uint256 resting = restingAskBaseRaw();
        uint256 requested = (uint256(newSizeSp) * baseMult) / sizePrecision;
        if (sold + resting + requested > sellAllowanceBase) {
            revert SellAllowanceExceeded(sold, resting, requested, sellAllowanceBase);
        }
    }

    /// @notice Price band: order price must be within ±bandBps of the current mid, read
    ///         from Kuru in the same tx. Handles the empty-side sentinel type(uint256).max.
    /// @dev UNITS: bestBidAsk() returns prices at 18-DECIMAL scale (verified on-chain:
    ///      price 1.0 -> 1e18), NOT in pricePrecision units. The incoming order `price` is
    ///      in pricePrecision units, so it is converted to the 18-dec scale before compare:
    ///      price18 = price * 1e18 / pricePrecision.
    function _checkBand(uint32 price) internal view {
        if (bandBps == 0) return; // band disabled
        uint256 mid = _midE18();
        if (mid == 0) revert EmptyBook(); // no reference price to band against

        uint256 price18 = (uint256(price) * 1e18) / pricePrecision;
        uint256 lo = (mid * (10_000 - bandBps)) / 10_000;
        uint256 hi = (mid * (10_000 + bandBps)) / 10_000;
        if (price18 < lo || price18 > hi) revert PriceOutOfBand(price18, lo, hi);
    }

    /// @dev Mid price at 18-decimal scale, or 0 if the book has no reference side.
    function _midE18() internal view returns (uint256) {
        (uint256 bestBid, uint256 bestAsk) = orderBook.bestBidAsk();
        bool haveBid = bestBid != type(uint256).max && bestBid != 0;
        bool haveAsk = bestAsk != type(uint256).max && bestAsk != 0;
        if (haveBid && haveAsk) return (bestBid + bestAsk) / 2;
        if (haveBid) return bestBid;
        if (haveAsk) return bestAsk;
        return 0;
    }

    /// @notice Public view mirror of the band check for tests / callers. `mid` is at
    ///         18-decimal scale (as Kuru's bestBidAsk returns it).
    function priceMid() external view returns (uint256 mid, bool haveBid, bool haveAsk) {
        (uint256 bestBid, uint256 bestAsk) = orderBook.bestBidAsk();
        haveBid = bestBid != type(uint256).max && bestBid != 0;
        haveAsk = bestAsk != type(uint256).max && bestAsk != 0;
        mid = _midE18();
    }

    // =========================================================================
    // Admin
    // =========================================================================

    function setMandate(uint256 _sellAllowanceBase, uint256 _bandBps) external onlyIssuer {
        sellAllowanceBase = _sellAllowanceBase;
        bandBps = _bandBps;
        emit MandateUpdated(_sellAllowanceBase, _bandBps);
    }

    function _removeOpen(uint40 orderId) internal {
        uint256 n = openAskIds.length;
        for (uint256 i = 0; i < n; i++) {
            if (openAskIds[i] == orderId) {
                openAskIds[i] = openAskIds[n - 1];
                openAskIds.pop();
                return;
            }
        }
        uint256 m = openBidIds.length;
        for (uint256 i = 0; i < m; i++) {
            if (openBidIds[i] == orderId) {
                openBidIds[i] = openBidIds[m - 1];
                openBidIds.pop();
                return;
            }
        }
    }
}
