// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Lifecycle states. ENDED is also derived lazily from the timestamp
///         (activatedAt + duration) in `currentState()`, even if `_rawState` still says
///         ACTIVE/PAUSED — see CovenantVault.currentState().
enum State {
    CREATED, // factory deployed, terms set, MM invited
    ACCEPTED, // MM accepted; terms locked
    ACTIVE, // issuer funded + activated; quoting allowed
    PAUSED, // issuer paused; no new orders, cancels allowed
    ENDED, // duration elapsed or issuer terminated; no new orders
    SETTLED // issuer withdrew everything; zero orders, zero margin
}

/// @notice Mandate terms. Immutable once the MM accepts (editable by the issuer only in
///         CREATED). windowLength & checkpointInterval are per-mandate so demos can use
///         minutes while production uses hours/days.
struct Terms {
    address market; // Kuru OrderBook (market) proxy
    address baseToken; // 18-dec base asset (the issuer's token)
    address quoteToken; // quote asset (e.g. USDC); also the fee currency
    address issuer; // set by the factory to createMandate's caller
    address mm; // invited market maker
    uint256 netSellCapPerWindow; // max NET base exposed/sold per window (base token units)
    uint256 windowLength; // governor window (seconds)
    uint256 bandBps; // max +/- distance of any vault order from mid (bps)
    uint256 maxOpenPerSide; // cap on simultaneous resting orders per side (1..10)
    uint256 maxSpreadBps; // KPI: max (vaultAsk-vaultBid)/mid (bps)
    uint256 minDepthPerSide; // KPI: min resting size per side (base token units)
    uint256 checkpointInterval; // KPI scoring interval (seconds)
    uint256 feePerInterval; // fee paid per passing interval (quote token units)
    uint256 duration; // mandate length (seconds) from activation
    uint256 maxConsecutiveFails; // K: consecutive failed intervals before issuer may early-terminate
}

/// @notice One resting order as seen by the UI.
struct OrderView {
    uint40 id;
    bool isBid;
    uint32 price; // pricePrecision units
    uint96 remaining; // sizePrecision units
}

/// @notice Everything the dashboard needs in ONE call. See CovenantVault.snapshot().
struct Snapshot {
    State state;
    Terms terms;
    uint64 activatedAt;
    uint64 endsAt;
    uint256 windowIndex;
    int256 soldBase; // signed net base disposed since deposit (negative = net bought)
    int256 netSoldInWindow; // soldBase - soldAtWindowStart
    uint256 remainingAllowance; // cap - (netSoldInWindow + restingAskBase), floored at 0
    OrderView[] openOrders;
    uint256 baseMargin; // vault's Kuru base margin (raw)
    uint256 quoteMargin; // vault's Kuru quote margin (raw)
    uint256 feeEscrow; // total quote escrowed for fees
    uint256 accruedFees; // earned by MM
    uint256 claimedFees; // claimed by MM
    uint256 currentInterval;
    bool currentObserved;
    bool currentPassed;
    bool currentFailed;
    uint256 consecutiveFails;
}
