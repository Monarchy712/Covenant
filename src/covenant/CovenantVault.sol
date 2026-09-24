// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IKuruOrderBook} from "../interfaces/IKuruOrderBook.sol";
import {IKuruMarginAccount} from "../interfaces/IKuruMarginAccount.sol";
import {State, Terms, OrderView, Snapshot} from "./CovenantTypes.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title CovenantVault
/// @notice A per-mandate vault that owns a Kuru market-making position and enforces a
///         market-making mandate the MM physically cannot break. It custodies inventory in
///         its OWN Kuru MarginAccount balance and owns every Kuru order (Kuru keys ownership
///         to ERC2771 `_msgSender()`, which for a direct contract call == this vault — proven
///         in the spike, see docs/KURU_ARCHITECTURE.md). The MM can only quote/cancel THROUGH
///         this contract; every placement is band/cap/governor-checked in the same tx.
///
///         Deployed as an EIP-1167 clone by CovenantFactory (initialize() instead of a
///         constructor), so factory bytecode stays tiny and well under the 24KB limit.
///
///         Kuru quirks reused from the spike (evidence: docs/KURU_ARCHITECTURE.md):
///         - addBuyOrder/addSellOrder return void; recover id from s_orderIdCounter() after.
///         - batchUpdate(buyP,buyS,sellP,sellS,cancelIds,postOnly) is the atomic cancel+place.
///         - resting orders debit the MarginAccount balance (deposit first).
///         - bestBidAsk() returns (uint256,uint256) at 18-dec scale; "no side" == uint256.max.
contract CovenantVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- Immutable-ish config (set once in initialize) -----------------------
    Terms public terms;
    IKuruOrderBook public orderBook;
    IKuruMarginAccount public marginAccount;

    uint256 public sizePrecision;
    uint256 public pricePrecision;
    uint256 public baseMult; // 10**baseDecimals
    uint256 public quoteMult; // 10**quoteDecimals

    // --- Lifecycle -----------------------------------------------------------
    State internal _rawState;
    uint64 public activatedAt;
    bool internal _initialized;

    // --- Accounting ----------------------------------------------------------
    uint256 public baseDepositedCumulative;
    uint256 public quoteDepositedCumulative;
    uint40[] public openBidIds;
    uint40[] public openAskIds;

    // --- Governor window -----------------------------------------------------
    uint256 public currentWindowIndex;
    int256 public soldAtWindowStart;

    // --- Checkpoint (fail-dominant) ------------------------------------------
    struct Interval {
        bool observed;
        bool passed;
        bool failed;
        bool finalized;
    }

    mapping(uint256 => Interval) public intervals;
    uint256 public nextFinalizeInterval; // first not-yet-finalized interval
    uint256 public consecutiveFails;

    /// @dev Bound the lazy-finalize catch-up loop so a huge time gap can't OOG a single call.
    uint256 internal constant MAX_FINALIZE_BATCH = 256;

    // --- Fees (held as quoteToken ERC20 in THIS contract, NOT in Kuru margin) -
    uint256 public feeEscrow; // total quote funded for fees
    uint256 public accruedFees; // earned by MM via finalized passing intervals
    uint256 public claimedFees; // claimed by MM

    // --- Events --------------------------------------------------------------
    event MandateAccepted(address indexed mm, uint256 ts);
    event InventoryDeposited(address indexed token, uint256 amount, uint256 cumulative);
    event FeesFunded(uint256 amount, uint256 escrowTotal);
    event Activated(uint256 ts, uint64 endsAt);
    event OrderPlaced(uint40 indexed id, bool isBid, uint32 price, uint96 size);
    event OrderCancelled(uint40 indexed id);
    event WindowRolled(uint256 indexed windowIndex, int256 soldAtWindowStart);
    event CheckpointObserved(
        uint256 indexed interval, bool passed, uint256 spreadBps, uint256 bidDepth, uint256 askDepth, uint256 mid
    );
    event IntervalFinalized(uint256 indexed interval, bool paid, uint256 amount);
    event FeeClaimed(uint256 amount);
    event Paused(uint256 ts);
    event Unpaused(uint256 ts);
    event Terminated(uint256 ts, bool afterKFails);
    event Withdrawn(address indexed token, uint256 amount);
    event Settled(uint256 ts);

    // --- Errors --------------------------------------------------------------
    error NotIssuer();
    error NotMM();
    error WrongState(State current);
    error AlreadyInitialized();
    error TermsLocked();
    error SellAllowanceExceeded(int256 netSold, uint256 restingAfter, uint256 requested, uint256 cap);
    error OutsideBand(uint256 price, uint256 mid, uint256 bandBps);
    error EmptyBook();
    error TooManyOpenOrders(bool isBid, uint256 count, uint256 max);
    error OpenOrdersRemain();
    error InsufficientEscrow();
    error LengthMismatch();
    error NothingToClaim();
    error NotActivatable();

    // --- Modifiers -----------------------------------------------------------
    modifier onlyIssuer() {
        if (msg.sender != terms.issuer) revert NotIssuer();
        _;
    }

    modifier onlyMM() {
        if (msg.sender != terms.mm) revert NotMM();
        _;
    }

    // =========================================================================
    // Initialization (clone pattern)
    // =========================================================================

    /// @notice One-time init, called atomically by CovenantFactory right after cloning.
    /// @dev Reads and caches market precisions; verifies the market's base/quote match terms.
    /// @param t mandate terms (issuer already set by the factory to its caller)
    /// @param margin the canonical Kuru MarginAccount for this network
    function initialize(Terms calldata t, address margin) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;

        terms = t;
        orderBook = IKuruOrderBook(t.market);
        marginAccount = IKuruMarginAccount(margin);

        (uint32 _pp, uint96 _sp, address _mktBase, uint256 _baseDec, address _mktQuote, uint256 _quoteDec,,,,,) =
            IKuruOrderBook(t.market).getMarketParams();
        require(_mktBase == t.baseToken && _mktQuote == t.quoteToken, "market/asset mismatch");
        pricePrecision = _pp;
        sizePrecision = _sp;
        baseMult = 10 ** _baseDec;
        quoteMult = 10 ** _quoteDec;

        _rawState = State.CREATED;
    }

    // =========================================================================
    // State helpers
    // =========================================================================

    /// @notice Effective state, deriving ENDED lazily from the clock.
    function currentState() public view returns (State) {
        State s = _rawState;
        if ((s == State.ACTIVE || s == State.PAUSED) && block.timestamp >= endsAt() && activatedAt != 0) {
            return State.ENDED;
        }
        return s;
    }

    function endsAt() public view returns (uint64) {
        if (activatedAt == 0) return 0;
        return activatedAt + uint64(terms.duration);
    }

    /// @dev Persist an expiry-driven transition to ENDED so events/finalization see it.
    function _syncEnd() internal {
        if ((_rawState == State.ACTIVE || _rawState == State.PAUSED) && activatedAt != 0 && block.timestamp >= endsAt())
        {
            _rawState = State.ENDED;
            emit Terminated(block.timestamp, false);
        }
    }

    // =========================================================================
    // Issuer: accept flow funding
    // =========================================================================

    /// @notice MM accepts the mandate; terms lock. CREATED -> ACCEPTED.
    function accept() external onlyMM {
        if (_rawState != State.CREATED) revert WrongState(_rawState);
        _rawState = State.ACCEPTED;
        emit MandateAccepted(msg.sender, block.timestamp);
    }

    /// @notice Issuer edits terms; allowed ONLY in CREATED (before the MM accepts).
    function updateTerms(Terms calldata t) external onlyIssuer {
        if (_rawState != State.CREATED) revert TermsLocked();
        // issuer/market/tokens are fixed at creation; only economic knobs may change here.
        require(
            t.market == terms.market && t.baseToken == terms.baseToken && t.quoteToken == terms.quoteToken
                && t.issuer == terms.issuer,
            "immutable field"
        );
        terms = t;
    }

    /// @notice Issuer changes the invited MM; CREATED only.
    function setMM(address newMM) external onlyIssuer {
        if (_rawState != State.CREATED) revert TermsLocked();
        require(newMM != address(0), "zero mm");
        terms.mm = newMM;
    }

    /// @notice Issuer funds the vault's OWN Kuru margin (base and/or quote inventory).
    function depositInventory(address token, uint256 amount) external onlyIssuer nonReentrant {
        require(token == terms.baseToken || token == terms.quoteToken, "bad token");
        State s = _rawState;
        require(s == State.ACCEPTED || s == State.ACTIVE, "deposit not allowed");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(token).forceApprove(address(marginAccount), amount);
        marginAccount.deposit(address(this), token, amount);
        if (token == terms.baseToken) baseDepositedCumulative += amount;
        else quoteDepositedCumulative += amount;
        emit InventoryDeposited(
            token, amount, token == terms.baseToken ? baseDepositedCumulative : quoteDepositedCumulative
        );
    }

    /// @notice Issuer funds the fee escrow (quote token held as ERC20 in this contract).
    function fundFees(uint256 amount) external onlyIssuer nonReentrant {
        State s = _rawState;
        require(s == State.ACCEPTED || s == State.ACTIVE, "fund not allowed");
        IERC20(terms.quoteToken).safeTransferFrom(msg.sender, address(this), amount);
        feeEscrow += amount;
        emit FeesFunded(amount, feeEscrow);
    }

    /// @notice Issuer activates the mandate. Requires inventory > 0 and escrow >= one fee.
    function activate() external onlyIssuer {
        if (_rawState != State.ACCEPTED) revert WrongState(_rawState);
        bool hasInventory = baseDepositedCumulative > 0 || quoteDepositedCumulative > 0;
        if (!hasInventory || feeEscrow < terms.feePerInterval) revert NotActivatable();
        _rawState = State.ACTIVE;
        activatedAt = uint64(block.timestamp);
        soldAtWindowStart = soldBaseSigned();
        currentWindowIndex = 0;
        emit Activated(block.timestamp, endsAt());
    }

    // =========================================================================
    // MM: quote / cancel
    // =========================================================================

    /// @notice Atomic cancel+place through the vault, band/cap/governor-checked in the same tx.
    /// @param bidPrices post-only bid prices (pricePrecision units)
    /// @param bidSizes  bid sizes (sizePrecision units)
    /// @param askPrices post-only ask prices
    /// @param askSizes  ask sizes
    /// @param cancelIds vault order ids to cancel first
    function quote(
        uint32[] calldata bidPrices,
        uint96[] calldata bidSizes,
        uint32[] calldata askPrices,
        uint96[] calldata askSizes,
        uint40[] calldata cancelIds
    ) external onlyMM nonReentrant {
        if (currentState() != State.ACTIVE) revert WrongState(currentState());
        if (bidPrices.length != bidSizes.length || askPrices.length != askSizes.length) revert LengthMismatch();

        _rollWindowIfNeeded();
        _pruneFilled();

        // --- Band: every new price within +/- bandBps of mid (18-dec scale). ---
        _checkBand(bidPrices, askPrices);

        // --- Remove cancelIds from our tracking; count what remains per side. ---
        uint256 remainingAskBase = _removeCancelsAndCountAskBase(cancelIds);

        // --- Open-order cap per side (after this op). ---
        uint256 bidsAfter = openBidIds.length + bidPrices.length;
        uint256 asksAfter = openAskIds.length + askPrices.length;
        if (bidsAfter > terms.maxOpenPerSide) revert TooManyOpenOrders(true, bidsAfter, terms.maxOpenPerSide);
        if (asksAfter > terms.maxOpenPerSide) revert TooManyOpenOrders(false, asksAfter, terms.maxOpenPerSide);

        // --- Net-sell governor: netSoldInWindow + restingAskBaseAfter <= cap. ---
        uint256 newAskBase;
        for (uint256 i = 0; i < askSizes.length; i++) {
            newAskBase += (uint256(askSizes[i]) * baseMult) / sizePrecision;
        }
        uint256 restingAskBaseAfter = remainingAskBase + newAskBase;
        int256 netSold = soldBaseSigned() - soldAtWindowStart;
        if (netSold + int256(restingAskBaseAfter) > int256(terms.netSellCapPerWindow)) {
            revert SellAllowanceExceeded(netSold, restingAskBaseAfter, newAskBase, terms.netSellCapPerWindow);
        }

        // --- Execute atomically on Kuru; recover ids from the monotonic counter. ---
        uint40 counterBefore = orderBook.s_orderIdCounter();
        orderBook.batchUpdate(bidPrices, bidSizes, askPrices, askSizes, cancelIds, true);

        for (uint256 i = 0; i < cancelIds.length; i++) {
            emit OrderCancelled(cancelIds[i]);
        }
        // batchUpdate places buys first, then sells; ids are sequential from counterBefore.
        uint40 next = counterBefore;
        for (uint256 i = 0; i < bidPrices.length; i++) {
            next += 1;
            openBidIds.push(next);
            emit OrderPlaced(next, true, bidPrices[i], bidSizes[i]);
        }
        for (uint256 i = 0; i < askPrices.length; i++) {
            next += 1;
            openAskIds.push(next);
            emit OrderPlaced(next, false, askPrices[i], askSizes[i]);
        }
    }

    /// @notice Cancel specific vault orders. Allowed for the MM in ACTIVE/PAUSED.
    function cancel(uint40[] calldata ids) external onlyMM nonReentrant {
        State s = currentState();
        if (s != State.ACTIVE && s != State.PAUSED) revert WrongState(s);
        _rollWindowIfNeeded();
        orderBook.batchCancelOrders(ids);
        for (uint256 i = 0; i < ids.length; i++) {
            _removeOpen(ids[i]);
            emit OrderCancelled(ids[i]);
        }
    }

    /// @notice After ENDED, anyone can cancel all of the vault's remaining orders so the
    ///         issuer can settle. Idempotent.
    function cancelAllAfterEnd() external nonReentrant {
        _syncEnd();
        if (currentState() != State.ENDED) revert WrongState(currentState());
        uint256 nBids = openBidIds.length;
        uint256 nAsks = openAskIds.length;
        uint40[] memory ids = new uint40[](nBids + nAsks);
        uint256 k;
        for (uint256 i = 0; i < nBids; i++) {
            ids[k++] = openBidIds[i];
        }
        for (uint256 i = 0; i < nAsks; i++) {
            ids[k++] = openAskIds[i];
        }
        if (ids.length > 0) orderBook.batchCancelOrders(ids);
        delete openBidIds;
        delete openAskIds;
        for (uint256 i = 0; i < ids.length; i++) {
            emit OrderCancelled(ids[i]);
        }
    }

    // =========================================================================
    // Governor window
    // =========================================================================

    /// @notice Permissionless: roll the governor window if the clock has advanced past it.
    function poke() external {
        _rollWindowIfNeeded();
    }

    function _rollWindowIfNeeded() internal {
        if (_rawState != State.ACTIVE || activatedAt == 0 || terms.windowLength == 0) return;
        uint256 idx = (block.timestamp - activatedAt) / terms.windowLength;
        if (idx != currentWindowIndex) {
            currentWindowIndex = idx;
            soldAtWindowStart = soldBaseSigned();
            emit WindowRolled(idx, soldAtWindowStart);
        }
    }

    // =========================================================================
    // KPI checkpoint (fail-dominant)
    // =========================================================================

    /// @notice Observe the vault's current quoting against the live mid and record a pass/fail
    ///         for the current interval. Callable by ANYONE, any number of times. ANY failing
    ///         observation in an interval permanently voids that interval's fee (fail-dominant).
    function checkpoint() external nonReentrant {
        if (currentState() != State.ACTIVE) revert WrongState(currentState());
        uint256 idx = (block.timestamp - activatedAt) / terms.checkpointInterval;
        _finalizeUpTo(idx);

        (bool passed, uint256 spreadBps, uint256 bidDepth, uint256 askDepth, uint256 mid) = _observe();
        Interval storage iv = intervals[idx];
        iv.observed = true;
        if (passed) iv.passed = true;
        else iv.failed = true;
        emit CheckpointObserved(idx, passed, spreadBps, bidDepth, askDepth, mid);
    }

    /// @notice Finalize intervals up to and including the last one after ENDED.
    function finalize() external nonReentrant {
        _syncEnd();
        State s = currentState();
        require(s == State.ENDED || s == State.SETTLED || s == State.ACTIVE || s == State.PAUSED, "n/a");
        uint256 idx;
        if (activatedAt == 0) return;
        if (s == State.ENDED || s == State.SETTLED) {
            // finalize every interval that has fully elapsed, up to the end.
            idx = (uint256(endsAt()) - activatedAt) / terms.checkpointInterval + 1;
        } else {
            idx = (block.timestamp - activatedAt) / terms.checkpointInterval;
        }
        _finalizeUpTo(idx);
    }

    /// @dev Finalize [nextFinalizeInterval, upTo). Paying interval: observed && passed && !failed.
    ///      Failing interval (for the K counter): observed && failed. Unobserved: neutral.
    function _finalizeUpTo(uint256 upTo) internal {
        uint256 i = nextFinalizeInterval;
        uint256 stop = upTo;
        if (stop > i + MAX_FINALIZE_BATCH) stop = i + MAX_FINALIZE_BATCH; // bound the loop
        for (; i < stop; i++) {
            Interval storage iv = intervals[i];
            if (iv.finalized) continue;
            iv.finalized = true;
            bool paid = iv.observed && iv.passed && !iv.failed;
            uint256 amount;
            if (paid) {
                amount = terms.feePerInterval;
                uint256 room = feeEscrow - accruedFees;
                if (amount > room) amount = room; // never accrue beyond escrow
                accruedFees += amount;
                consecutiveFails = 0;
            } else if (iv.observed && iv.failed) {
                consecutiveFails += 1;
            }
            emit IntervalFinalized(i, paid, amount);
        }
        if (i > nextFinalizeInterval) nextFinalizeInterval = i;
    }

    /// @dev Score the vault's current resting orders vs the live mid.
    function _observe()
        internal
        view
        returns (bool passed, uint256 spreadBps, uint256 bidDepth, uint256 askDepth, uint256 mid)
    {
        mid = _midE18();
        (uint32 bestBidPx, uint256 bidBase) = _bestBidAndDepth();
        (uint32 bestAskPx, uint256 askBase) = _bestAskAndDepth();
        bidDepth = bidBase;
        askDepth = askBase;
        if (mid == 0 || bestBidPx == 0 || bestAskPx == 0) return (false, 0, bidDepth, askDepth, mid);

        // both sides inside band?
        uint256 lo = (mid * (10_000 - terms.bandBps)) / 10_000;
        uint256 hi = (mid * (10_000 + terms.bandBps)) / 10_000;
        uint256 bid18 = (uint256(bestBidPx) * 1e18) / pricePrecision;
        uint256 ask18 = (uint256(bestAskPx) * 1e18) / pricePrecision;
        if (bid18 < lo || bid18 > hi || ask18 < lo || ask18 > hi) return (false, 0, bidDepth, askDepth, mid);

        // spread
        if (ask18 <= bid18) return (false, 0, bidDepth, askDepth, mid);
        spreadBps = ((ask18 - bid18) * 10_000) / mid;
        if (spreadBps > terms.maxSpreadBps) return (false, spreadBps, bidDepth, askDepth, mid);

        // depth
        if (bidDepth < terms.minDepthPerSide || askDepth < terms.minDepthPerSide) {
            return (false, spreadBps, bidDepth, askDepth, mid);
        }
        passed = true;
    }

    // =========================================================================
    // Fees
    // =========================================================================

    /// @notice MM claims earned-but-unclaimed fees (quote token).
    function claimFees() external onlyMM nonReentrant {
        uint256 claimable = accruedFees - claimedFees;
        if (claimable == 0) revert NothingToClaim();
        claimedFees += claimable;
        IERC20(terms.quoteToken).safeTransfer(terms.mm, claimable);
        emit FeeClaimed(claimable);
    }

    // =========================================================================
    // Issuer: pause / terminate / withdraw
    // =========================================================================

    function pause() external onlyIssuer {
        if (currentState() != State.ACTIVE) revert WrongState(currentState());
        _rawState = State.PAUSED;
        emit Paused(block.timestamp);
    }

    function unpause() external onlyIssuer {
        if (currentState() != State.PAUSED) revert WrongState(currentState());
        _rawState = State.ACTIVE;
        emit Unpaused(block.timestamp);
    }

    /// @notice Issuer's early-termination right, valid any time before ENDED.
    function terminate() external onlyIssuer {
        State s = currentState();
        if (s != State.ACTIVE && s != State.PAUSED) revert WrongState(s);
        bool afterK = consecutiveFails >= terms.maxConsecutiveFails;
        _rawState = State.ENDED;
        emit Terminated(block.timestamp, afterK);
    }

    /// @notice After ENDED with zero open orders, withdraw all inventory + proceeds to the
    ///         issuer and return unused fee escrow. -> SETTLED.
    function withdraw() external onlyIssuer nonReentrant {
        _syncEnd();
        if (currentState() != State.ENDED) revert WrongState(currentState());
        if (openBidIds.length != 0 || openAskIds.length != 0) revert OpenOrdersRemain();

        // pull base + quote out of Kuru margin to this contract, then to the issuer.
        uint256 baseBal = marginAccount.getBalance(address(this), terms.baseToken);
        uint256 quoteBal = marginAccount.getBalance(address(this), terms.quoteToken);
        if (baseBal > 0) {
            marginAccount.withdraw(baseBal, terms.baseToken);
            IERC20(terms.baseToken).safeTransfer(terms.issuer, baseBal);
            emit Withdrawn(terms.baseToken, baseBal);
        }
        if (quoteBal > 0) {
            marginAccount.withdraw(quoteBal, terms.quoteToken);
            IERC20(terms.quoteToken).safeTransfer(terms.issuer, quoteBal);
            emit Withdrawn(terms.quoteToken, quoteBal);
        }
        // return unused escrow (escrow - accrued); accrued-claimed stays for the MM to claim.
        uint256 unused = feeEscrow - accruedFees;
        if (unused > 0) {
            feeEscrow -= unused;
            IERC20(terms.quoteToken).safeTransfer(terms.issuer, unused);
            emit Withdrawn(terms.quoteToken, unused);
        }
        _rawState = State.SETTLED;
        emit Settled(block.timestamp);
    }

    // =========================================================================
    // Views: sold / resting / band
    // =========================================================================

    /// @notice Signed net base disposed since deposit: deposited - freeMargin - lockedInAsks.
    ///         Negative when the vault has net-bought (bid fills) beyond what was deposited.
    function soldBaseSigned() public view returns (int256) {
        uint256 freeMargin = marginAccount.getBalance(address(this), terms.baseToken);
        uint256 locked = restingAskBaseRaw();
        return int256(baseDepositedCumulative) - int256(freeMargin) - int256(locked);
    }

    /// @notice Base (raw token units) currently locked across the vault's resting asks.
    function restingAskBaseRaw() public view returns (uint256 total) {
        uint256 n = openAskIds.length;
        for (uint256 i = 0; i < n; i++) {
            (address owner, uint96 sz,,,,,,) = orderBook.s_orders(openAskIds[i]);
            if (owner == address(this)) total += (uint256(sz) * baseMult) / sizePrecision;
        }
    }

    function netSoldInWindow() public view returns (int256) {
        return soldBaseSigned() - soldAtWindowStart;
    }

    function _midE18() internal view returns (uint256) {
        (uint256 bestBid, uint256 bestAsk) = orderBook.bestBidAsk();
        bool haveBid = bestBid != type(uint256).max && bestBid != 0;
        bool haveAsk = bestAsk != type(uint256).max && bestAsk != 0;
        if (haveBid && haveAsk) return (bestBid + bestAsk) / 2;
        if (haveBid) return bestBid;
        if (haveAsk) return bestAsk;
        return 0;
    }

    /// @dev Band check for a quote. When the live book is empty (mid==0), require a two-sided
    ///      quote and derive the reference mid from the proposed orders (bootstrapping). This
    ///      is the documented fallback (spike used a pre-seeded book; production markets carry
    ///      AMM-vault liquidity so mid>0). One-sided into an empty book reverts EmptyBook.
    function _checkBand(uint32[] calldata bidPrices, uint32[] calldata askPrices) internal view {
        if (terms.bandBps == 0) return;
        uint256 mid = _midE18();
        if (mid == 0) {
            if (bidPrices.length == 0 || askPrices.length == 0) revert EmptyBook();
            uint256 hiBid;
            for (uint256 i = 0; i < bidPrices.length; i++) {
                uint256 p = (uint256(bidPrices[i]) * 1e18) / pricePrecision;
                if (p > hiBid) hiBid = p;
            }
            uint256 loAsk = type(uint256).max;
            for (uint256 i = 0; i < askPrices.length; i++) {
                uint256 p = (uint256(askPrices[i]) * 1e18) / pricePrecision;
                if (p < loAsk) loAsk = p;
            }
            require(loAsk >= hiBid, "crossed seed");
            mid = (hiBid + loAsk) / 2;
        }
        uint256 lo = (mid * (10_000 - terms.bandBps)) / 10_000;
        uint256 hi = (mid * (10_000 + terms.bandBps)) / 10_000;
        for (uint256 i = 0; i < bidPrices.length; i++) {
            uint256 p = (uint256(bidPrices[i]) * 1e18) / pricePrecision;
            if (p < lo || p > hi) revert OutsideBand(p, mid, terms.bandBps);
        }
        for (uint256 i = 0; i < askPrices.length; i++) {
            uint256 p = (uint256(askPrices[i]) * 1e18) / pricePrecision;
            if (p < lo || p > hi) revert OutsideBand(p, mid, terms.bandBps);
        }
    }

    /// @dev Best (highest) bid price and total bid depth (base units) from the vault's orders.
    function _bestBidAndDepth() internal view returns (uint32 bestPx, uint256 depthBase) {
        uint256 n = openBidIds.length;
        for (uint256 i = 0; i < n; i++) {
            (address owner, uint96 sz,,,,, uint32 px,) = _order(openBidIds[i]);
            if (owner != address(this) || sz == 0) continue;
            if (px > bestPx) bestPx = px;
            depthBase += (uint256(sz) * baseMult) / sizePrecision;
        }
    }

    /// @dev Best (lowest) ask price and total ask depth (base units) from the vault's orders.
    function _bestAskAndDepth() internal view returns (uint32 bestPx, uint256 depthBase) {
        uint256 n = openAskIds.length;
        uint32 low = type(uint32).max;
        for (uint256 i = 0; i < n; i++) {
            (address owner, uint96 sz,,,,, uint32 px,) = _order(openAskIds[i]);
            if (owner != address(this) || sz == 0) continue;
            if (px < low) low = px;
            depthBase += (uint256(sz) * baseMult) / sizePrecision;
        }
        if (low != type(uint32).max) bestPx = low;
    }

    function _order(uint40 id) internal view returns (address, uint96, uint40, uint40, uint40, uint32, uint32, bool) {
        return orderBook.s_orders(id);
    }

    // =========================================================================
    // Order-id bookkeeping
    // =========================================================================

    /// @dev Drop ids whose on-chain order is gone (owner==0) or fully filled (size==0).
    function _pruneFilled() internal {
        _pruneList(openBidIds);
        _pruneList(openAskIds);
    }

    function _pruneList(uint40[] storage list) internal {
        uint256 i;
        while (i < list.length) {
            (address owner, uint96 sz,,,,,,) = orderBook.s_orders(list[i]);
            if (owner != address(this) || sz == 0) {
                list[i] = list[list.length - 1];
                list.pop();
            } else {
                i++;
            }
        }
    }

    /// @dev Remove cancelIds from both lists; return the base still locked in *remaining* asks.
    function _removeCancelsAndCountAskBase(uint40[] calldata cancelIds) internal returns (uint256 remainingAskBase) {
        for (uint256 i = 0; i < cancelIds.length; i++) {
            _removeOpen(cancelIds[i]);
        }
        remainingAskBase = restingAskBaseRaw();
    }

    function _removeOpen(uint40 id) internal {
        uint256 n = openAskIds.length;
        for (uint256 i = 0; i < n; i++) {
            if (openAskIds[i] == id) {
                openAskIds[i] = openAskIds[n - 1];
                openAskIds.pop();
                return;
            }
        }
        uint256 m = openBidIds.length;
        for (uint256 i = 0; i < m; i++) {
            if (openBidIds[i] == id) {
                openBidIds[i] = openBidIds[m - 1];
                openBidIds.pop();
                return;
            }
        }
    }

    // =========================================================================
    // UI views
    // =========================================================================

    function openBidCount() external view returns (uint256) {
        return openBidIds.length;
    }

    function openAskCount() external view returns (uint256) {
        return openAskIds.length;
    }

    /// @notice Everything the dashboard needs in one call.
    function snapshot() external view returns (Snapshot memory s) {
        s.state = currentState();
        s.terms = terms;
        s.activatedAt = activatedAt;
        s.endsAt = endsAt();
        s.windowIndex = currentWindowIndex;
        s.soldBase = soldBaseSigned();
        s.netSoldInWindow = s.soldBase - soldAtWindowStart;
        {
            int256 rem = int256(terms.netSellCapPerWindow) - (s.netSoldInWindow + int256(restingAskBaseRaw()));
            s.remainingAllowance = rem > 0 ? uint256(rem) : 0;
        }
        s.openOrders = _allOpenOrders();
        s.baseMargin = marginAccount.getBalance(address(this), terms.baseToken);
        s.quoteMargin = marginAccount.getBalance(address(this), terms.quoteToken);
        s.feeEscrow = feeEscrow;
        s.accruedFees = accruedFees;
        s.claimedFees = claimedFees;
        if (activatedAt != 0 && terms.checkpointInterval != 0) {
            s.currentInterval = (block.timestamp - activatedAt) / terms.checkpointInterval;
            Interval storage iv = intervals[s.currentInterval];
            s.currentObserved = iv.observed;
            s.currentPassed = iv.passed;
            s.currentFailed = iv.failed;
        }
        s.consecutiveFails = consecutiveFails;
    }

    function _allOpenOrders() internal view returns (OrderView[] memory list) {
        uint256 nb = openBidIds.length;
        uint256 na = openAskIds.length;
        list = new OrderView[](nb + na);
        uint256 k;
        for (uint256 i = 0; i < nb; i++) {
            (address o, uint96 sz,,,, uint32 px,,) = orderBook.s_orders(openBidIds[i]);
            list[k++] = OrderView(openBidIds[i], true, px, o == address(this) ? sz : 0);
        }
        for (uint256 i = 0; i < na; i++) {
            (address o, uint96 sz,,,,, uint32 px,) = orderBook.s_orders(openAskIds[i]);
            list[k++] = OrderView(openAskIds[i], false, px, o == address(this) ? sz : 0);
        }
    }

    /// @notice Dry-run a quote's checks and return the selector of the error the real call
    ///         would revert with (bytes4(0) == OK). Powers the MM console's red preflight.
    function previewQuote(
        uint32[] calldata bidPrices,
        uint96[] calldata bidSizes,
        uint32[] calldata askPrices,
        uint96[] calldata askSizes,
        uint40[] calldata cancelIds
    ) external view returns (bytes4 errorSelector) {
        if (currentState() != State.ACTIVE) return WrongState.selector;
        if (bidPrices.length != bidSizes.length || askPrices.length != askSizes.length) {
            return LengthMismatch.selector;
        }
        // band
        bytes4 bandErr = _previewBand(bidPrices, askPrices);
        if (bandErr != bytes4(0)) return bandErr;
        // cap (simulate cancels)
        (uint256 remBids, uint256 remAsks, uint256 remainingAskBase) = _simulateCancels(cancelIds);
        if (remBids + bidPrices.length > terms.maxOpenPerSide) return TooManyOpenOrders.selector;
        if (remAsks + askPrices.length > terms.maxOpenPerSide) return TooManyOpenOrders.selector;
        // governor
        uint256 newAskBase;
        for (uint256 i = 0; i < askSizes.length; i++) {
            newAskBase += (uint256(askSizes[i]) * baseMult) / sizePrecision;
        }
        int256 netSold = soldBaseSigned() - soldAtWindowStart;
        if (netSold + int256(remainingAskBase + newAskBase) > int256(terms.netSellCapPerWindow)) {
            return SellAllowanceExceeded.selector;
        }
        return bytes4(0);
    }

    function _previewBand(uint32[] calldata bidPrices, uint32[] calldata askPrices) internal view returns (bytes4) {
        if (terms.bandBps == 0) return bytes4(0);
        uint256 mid = _midE18();
        if (mid == 0) {
            if (bidPrices.length == 0 || askPrices.length == 0) return EmptyBook.selector;
            return bytes4(0); // bootstrapping seed accepted (matches _checkBand)
        }
        uint256 lo = (mid * (10_000 - terms.bandBps)) / 10_000;
        uint256 hi = (mid * (10_000 + terms.bandBps)) / 10_000;
        for (uint256 i = 0; i < bidPrices.length; i++) {
            uint256 p = (uint256(bidPrices[i]) * 1e18) / pricePrecision;
            if (p < lo || p > hi) return OutsideBand.selector;
        }
        for (uint256 i = 0; i < askPrices.length; i++) {
            uint256 p = (uint256(askPrices[i]) * 1e18) / pricePrecision;
            if (p < lo || p > hi) return OutsideBand.selector;
        }
        return bytes4(0);
    }

    /// @dev Count remaining bids/asks and remaining ask base if `cancelIds` were removed.
    function _simulateCancels(uint40[] calldata cancelIds)
        internal
        view
        returns (uint256 remBids, uint256 remAsks, uint256 remainingAskBase)
    {
        uint256 nb = openBidIds.length;
        for (uint256 i = 0; i < nb; i++) {
            if (!_contains(cancelIds, openBidIds[i])) remBids++;
        }
        uint256 na = openAskIds.length;
        for (uint256 i = 0; i < na; i++) {
            uint40 id = openAskIds[i];
            if (_contains(cancelIds, id)) continue;
            remAsks++;
            (address o, uint96 sz,,,,,,) = orderBook.s_orders(id);
            if (o == address(this)) remainingAskBase += (uint256(sz) * baseMult) / sizePrecision;
        }
    }

    function _contains(uint40[] calldata arr, uint40 v) internal pure returns (bool) {
        for (uint256 i = 0; i < arr.length; i++) {
            if (arr[i] == v) return true;
        }
        return false;
    }
}
