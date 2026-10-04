// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice The anon-aadhaar on-chain verifier (packages/contracts/src/AnonAadhaar.sol).
///         It holds the RSA public-key hash it trusts as an immutable, so the
///         trust anchor is fixed when the verifier is deployed.
interface IAnonAadhaar {
    function verifyAnonAadhaarProof(
        uint256 nullifierSeed,
        uint256 nullifier,
        uint256 timestamp,
        uint256 signal,
        uint256[4] calldata revealArray,
        uint256[8] calldata groth16Proof
    ) external view returns (bool);

    function storedPublicKeyHash() external view returns (uint256);
}

/// @notice The only part of an ERC-8004 Identity Registry (ERC-721) we need.
interface IERC8004Identity {
    function ownerOf(uint256 agentId) external view returns (address);
}

/// @title  HumanBindingRegistry
/// @notice Binds an ERC-8004 agent to a unique, adult human proven with an
///         anon-aadhaar zero-knowledge proof. Records `agentId -> nullifier`,
///         never any personal data.
///
///         Security properties enforced here (not by the client):
///         - Trust anchor: the verifier's RSA key hash is read once at deploy
///           time and is immutable. There is no flag a caller can pass to
///           switch between the UIDAI production key and the public test key.
///           The constructor also refuses to deploy if the anchor does not
///           match what the deployer said they expected.
///         - Uniqueness: `nullifierSeed` is an immutable of this registry and is
///           passed to the verifier by the contract. A caller cannot pick a
///           different seed to mint a fresh nullifier for the same person.
///         - Disclosure policy: the contract hardcodes the reveal vector as
///           [ageAbove18 = 1, gender = 0, pincode = 0, state = 0]. A proof that
///           reveals anything else, or is not 18+, fails verification.
///         - Replay: the proof's signal is computed on-chain from
///           (chainid, this registry, identity registry, agentId, owner, nonce).
///           A proof for agent A cannot bind agent B, cannot be used on another
///           chain or registry, and stops working after any revoke/rebind.
///         - Transfer: a binding is only "live" while the agent NFT is still
///           held by the address that bound it. Selling or handing over the
///           agent token silently drops the badge.
contract HumanBindingRegistry {
    /// @dev anon-aadhaar test public key hash (circuits/assets/testPublicKey.pem).
    uint256 public constant TEST_PUBKEY_HASH =
        15134874015316324267425466444584014077184337590635665158241104437045239495873;
    /// @dev UIDAI production key hash (uidai_offline_publickey_26022021.cer).
    uint256 public constant PRODUCTION_PUBKEY_HASH =
        18063425702624337643644061197836918910810808173893535653269228433734128853484;

    bytes32 public constant BIND_DOMAIN = keccak256("humanbehind.bind.v1");
    bytes32 public constant REVOKE_DOMAIN = keccak256("humanbehind.revoke.v1");

    /// @dev Allowed clock skew for a QR timestamp that is slightly in the future
    ///      (QR timestamps are hour-granular and IST-derived).
    uint256 public constant FUTURE_SKEW = 1 hours;
    uint256 public constant MAX_PROOF_AGE_CAP = 30 days;
    /// @dev Gas forwarded to the groth16 verifier. A valid verify costs ~250k.
    ///      Without a cap, a malformed proof makes the pairing precompile burn
    ///      all forwarded gas (observed ~1B gas in tests).
    uint256 public constant VERIFY_GAS_LIMIT = 1_000_000;

    IAnonAadhaar public immutable anonAadhaar;
    IERC8004Identity public immutable identityRegistry;
    uint256 public immutable nullifierSeed;
    uint256 public immutable trustAnchorPubkeyHash;
    bool public immutable isTestAnchor;

    address public admin;
    uint256 public maxAgentsPerHuman;
    uint256 public maxProofAge;

    struct Binding {
        uint256 nullifier;
        address boundOwner;
        uint64 boundAt;
        uint64 qrTimestamp;
        bool ageAbove18;
        bool active;
    }

    mapping(uint256 agentId => Binding) private _bindings;
    /// @notice Live bindings per human (per nullifier).
    mapping(uint256 nullifier => uint256) public agentsOf;
    /// @notice Incremented on every bind and revoke; part of the signal.
    mapping(uint256 agentId => uint256) public nonceOf;

    event HumanBound(uint256 indexed agentId, uint256 indexed nullifier, address indexed owner, uint256 qrTimestamp);
    event BindingRevoked(uint256 indexed agentId, uint256 indexed nullifier, RevokeReason reason);
    event MaxAgentsPerHumanSet(uint256 value);
    event MaxProofAgeSet(uint256 value);
    event AdminTransferred(address indexed from, address indexed to);

    enum RevokeReason {
        Owner,
        Human,
        StaleOwner
    }

    error ZeroAddress();
    error AnchorMismatch(uint256 actual);
    error UnknownAnchor(uint256 actual);
    error NotAdmin();
    error NotAgentOwner();
    error AlreadyBound();
    error NotBound();
    error NotStale();
    error ProofExpired();
    error ProofFromFuture();
    error InvalidProof();
    error HumanAgentLimit();
    error NullifierMismatch();
    error BadConfig();

    constructor(
        IAnonAadhaar anonAadhaar_,
        IERC8004Identity identityRegistry_,
        uint256 nullifierSeed_,
        bool expectTestAnchor,
        uint256 maxAgentsPerHuman_,
        uint256 maxProofAge_
    ) {
        if (address(anonAadhaar_) == address(0) || address(identityRegistry_) == address(0)) {
            revert ZeroAddress();
        }
        if (nullifierSeed_ == 0 || maxAgentsPerHuman_ == 0) revert BadConfig();
        if (maxProofAge_ == 0 || maxProofAge_ > MAX_PROOF_AGE_CAP) revert BadConfig();

        uint256 anchor = anonAadhaar_.storedPublicKeyHash();
        bool test_ = anchor == TEST_PUBKEY_HASH;
        if (!test_ && anchor != PRODUCTION_PUBKEY_HASH) revert UnknownAnchor(anchor);
        if (test_ != expectTestAnchor) revert AnchorMismatch(anchor);

        anonAadhaar = anonAadhaar_;
        identityRegistry = identityRegistry_;
        nullifierSeed = nullifierSeed_;
        trustAnchorPubkeyHash = anchor;
        isTestAnchor = test_;
        admin = msg.sender;
        maxAgentsPerHuman = maxAgentsPerHuman_;
        maxProofAge = maxProofAge_;
        emit AdminTransferred(address(0), msg.sender);
        emit MaxAgentsPerHumanSet(maxAgentsPerHuman_);
        emit MaxProofAgeSet(maxProofAge_);
    }

    // ------------------------------------------------------------------
    // Signals: what the human's proof commits to
    // ------------------------------------------------------------------

    /// @notice The signal a proof must commit to in order to bind `agentId`
    ///         from `owner`. The client fetches this and passes it to the prover.
    function bindSignal(uint256 agentId, address owner) public view returns (uint256) {
        return uint256(
            keccak256(
                abi.encode(
                    BIND_DOMAIN,
                    block.chainid,
                    address(this),
                    address(identityRegistry),
                    agentId,
                    owner,
                    nonceOf[agentId]
                )
            )
        );
    }

    /// @notice The signal a proof must commit to for the human to revoke
    ///         `agentId` without the owner's wallet (e.g. wallet compromised).
    function revokeSignal(uint256 agentId) public view returns (uint256) {
        return uint256(
            keccak256(
                abi.encode(
                    REVOKE_DOMAIN, block.chainid, address(this), address(identityRegistry), agentId, nonceOf[agentId]
                )
            )
        );
    }

    // ------------------------------------------------------------------
    // Bind / revoke
    // ------------------------------------------------------------------

    /// @notice Bind the caller's agent to the human behind `groth16Proof`.
    /// @param  agentId     ERC-8004 agent the caller owns.
    /// @param  nullifier   Proof public output: per-app unique human id.
    /// @param  timestamp   Proof public output: QR signing time (UTC, unix).
    /// @param  groth16Proof Packed proof (anon-aadhaar `packGroth16Proof`).
    function bind(uint256 agentId, uint256 nullifier, uint256 timestamp, uint256[8] calldata groth16Proof) external {
        if (identityRegistry.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        // Fix the expected signal before any state change (clearing a stale
        // binding below bumps the nonce, which would otherwise move the target).
        uint256 signal = bindSignal(agentId, msg.sender);

        Binding storage b = _bindings[agentId];
        if (b.active) {
            if (b.boundOwner == msg.sender) revert AlreadyBound();
            // Previous owner's binding is stale (agent was transferred): release it.
            _clear(agentId, RevokeReason.StaleOwner);
        }

        _checkFresh(timestamp);
        if (!_verify(nullifier, timestamp, signal, groth16Proof)) revert InvalidProof();
        if (agentsOf[nullifier] >= maxAgentsPerHuman) revert HumanAgentLimit();

        unchecked {
            agentsOf[nullifier] += 1;
            nonceOf[agentId] += 1;
        }
        _bindings[agentId] = Binding({
            nullifier: nullifier,
            boundOwner: msg.sender,
            boundAt: uint64(block.timestamp),
            qrTimestamp: uint64(timestamp),
            ageAbove18: true, // enforced by the hardcoded reveal vector
            active: true
        });
        emit HumanBound(agentId, nullifier, msg.sender, timestamp);
    }

    /// @notice Current agent owner drops the human binding.
    function revokeByOwner(uint256 agentId) external {
        if (!_bindings[agentId].active) revert NotBound();
        if (identityRegistry.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        _clear(agentId, RevokeReason.Owner);
    }

    /// @notice The human revokes with a fresh proof, without needing the
    ///         wallet. Anyone may relay it. The proof must come from the same
    ///         human (same nullifier) and commit to `revokeSignal(agentId)`.
    function revokeByHuman(uint256 agentId, uint256 nullifier, uint256 timestamp, uint256[8] calldata groth16Proof)
        external
    {
        Binding storage b = _bindings[agentId];
        if (!b.active) revert NotBound();
        if (b.nullifier != nullifier) revert NullifierMismatch();
        _checkFresh(timestamp);
        if (!_verify(nullifier, timestamp, revokeSignal(agentId), groth16Proof)) revert InvalidProof();
        _clear(agentId, RevokeReason.Human);
    }

    /// @notice Anyone can clear a binding whose agent changed hands, freeing
    ///         the human's slot.
    function pruneStale(uint256 agentId) external {
        Binding storage b = _bindings[agentId];
        if (!b.active) revert NotBound();
        if (_currentOwner(agentId) == b.boundOwner) revert NotStale();
        _clear(agentId, RevokeReason.StaleOwner);
    }

    // ------------------------------------------------------------------
    // Reads
    // ------------------------------------------------------------------

    /// @notice True iff the agent has a live binding: a valid proof was
    ///         accepted and the agent is still held by the address that bound it.
    ///         Note: also true under the test anchor. Consumers that need real
    ///         humans must also check `isTestAnchor == false`.
    function isHumanBacked(uint256 agentId) public view returns (bool) {
        Binding storage b = _bindings[agentId];
        return b.active && _currentOwner(agentId) == b.boundOwner;
    }

    struct Attestation {
        bool humanBacked;
        bool ageAbove18;
        bool testAnchor;
        uint256 nullifier;
        address boundOwner;
        uint64 boundAt;
        uint64 qrTimestamp;
        uint256 agentsForHuman;
        uint256 maxAgentsForHuman;
    }

    function attestation(uint256 agentId) external view returns (Attestation memory a) {
        Binding storage b = _bindings[agentId];
        a.humanBacked = isHumanBacked(agentId);
        a.ageAbove18 = b.ageAbove18 && b.active;
        a.testAnchor = isTestAnchor;
        a.nullifier = b.active ? b.nullifier : 0;
        a.boundOwner = b.active ? b.boundOwner : address(0);
        a.boundAt = b.active ? b.boundAt : 0;
        a.qrTimestamp = b.active ? b.qrTimestamp : 0;
        a.agentsForHuman = b.active ? agentsOf[b.nullifier] : 0;
        a.maxAgentsForHuman = maxAgentsPerHuman;
    }

    // ------------------------------------------------------------------
    // Admin (policy knobs only; the trust anchor and seed are immutable)
    // ------------------------------------------------------------------

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    /// @dev Lowering the cap does not evict existing bindings; it only blocks new ones.
    function setMaxAgentsPerHuman(uint256 value) external onlyAdmin {
        if (value == 0) revert BadConfig();
        maxAgentsPerHuman = value;
        emit MaxAgentsPerHumanSet(value);
    }

    function setMaxProofAge(uint256 value) external onlyAdmin {
        if (value == 0 || value > MAX_PROOF_AGE_CAP) revert BadConfig();
        maxProofAge = value;
        emit MaxProofAgeSet(value);
    }

    function transferAdmin(address to) external onlyAdmin {
        if (to == address(0)) revert ZeroAddress();
        emit AdminTransferred(admin, to);
        admin = to;
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _verify(uint256 nullifier, uint256 timestamp, uint256 signal, uint256[8] calldata proof)
        internal
        view
        returns (bool)
    {
        if (nullifier == 0) return false;
        // Disclosure policy: 18+ revealed and true; gender, pincode, state hidden.
        uint256[4] memory reveal = [uint256(1), 0, 0, 0];
        try anonAadhaar.verifyAnonAadhaarProof{gas: VERIFY_GAS_LIMIT}(
            nullifierSeed, nullifier, timestamp, signal, reveal, proof
        ) returns (
            bool ok
        ) {
            return ok;
        } catch {
            return false;
        }
    }

    function _checkFresh(uint256 timestamp) internal view {
        if (timestamp > block.timestamp + FUTURE_SKEW) revert ProofFromFuture();
        if (timestamp + maxProofAge < block.timestamp) revert ProofExpired();
    }

    function _currentOwner(uint256 agentId) internal view returns (address) {
        try identityRegistry.ownerOf(agentId) returns (address o) {
            return o;
        } catch {
            return address(0);
        }
    }

    function _clear(uint256 agentId, RevokeReason reason) internal {
        Binding storage b = _bindings[agentId];
        uint256 n = b.nullifier;
        unchecked {
            agentsOf[n] -= 1;
            nonceOf[agentId] += 1;
        }
        delete _bindings[agentId];
        emit BindingRevoked(agentId, n, reason);
    }
}
