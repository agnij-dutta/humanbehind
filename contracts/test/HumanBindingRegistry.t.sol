// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {HumanBindingRegistry, IAnonAadhaar, IERC8004Identity} from "../src/HumanBindingRegistry.sol";
import {AgentIdentityRegistry} from "../src/AgentIdentityRegistry.sol";
import {MockAnonAadhaar, RevertingAnonAadhaar} from "./mocks/MockAnonAadhaar.sol";

contract HumanBindingRegistryTest is Test {
    uint256 constant SEED = 0x6875;
    uint256 constant ALICE_NULL = 111;
    uint256 constant BOB_NULL = 222;

    MockAnonAadhaar verifier;
    AgentIdentityRegistry ids;
    HumanBindingRegistry reg;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address mallory = makeAddr("mallory");

    uint256 ts;

    function setUp() public {
        vm.warp(1_760_000_000);
        ts = block.timestamp - 1 hours;
        verifier = new MockAnonAadhaar(15134874015316324267425466444584014077184337590635665158241104437045239495873);
        ids = new AgentIdentityRegistry();
        reg = new HumanBindingRegistry(
            IAnonAadhaar(address(verifier)), IERC8004Identity(address(ids)), SEED, true, 3, 1 days
        );
    }

    // --- helpers ---

    function _proof(uint256 tag) internal pure returns (uint256[8] memory p) {
        for (uint256 i; i < 8; i++) {
            p[i] = tag + i;
        }
    }

    function _adultOnly() internal pure returns (uint256[4] memory r) {
        r[0] = 1;
    }

    /// Simulates the human generating a proof for the current bind signal.
    function _mintBindProof(uint256 agentId, address owner, uint256 nullifier, uint256 tag)
        internal
        returns (uint256[8] memory p)
    {
        p = _proof(tag);
        verifier.accept(SEED, nullifier, ts, reg.bindSignal(agentId, owner), _adultOnly(), p);
    }

    function _register(address who) internal returns (uint256 id) {
        vm.prank(who);
        id = ids.register("ipfs://card");
    }

    function _bind(address who, uint256 agentId, uint256 nullifier, uint256 tag) internal {
        uint256[8] memory p = _mintBindProof(agentId, who, nullifier, tag);
        vm.prank(who);
        reg.bind(agentId, nullifier, ts, p);
    }

    // --- happy path ---

    function test_bind_happyPath() public {
        uint256 id = _register(alice);
        _bind(alice, id, ALICE_NULL, 1);
        assertTrue(reg.isHumanBacked(id));
        HumanBindingRegistry.Attestation memory a = reg.attestation(id);
        assertTrue(a.humanBacked);
        assertTrue(a.ageAbove18);
        assertTrue(a.testAnchor);
        assertEq(a.nullifier, ALICE_NULL);
        assertEq(a.boundOwner, alice);
        assertEq(a.agentsForHuman, 1);
        assertEq(reg.agentsOf(ALICE_NULL), 1);
    }

    function test_unboundAgentIsNotBacked() public {
        uint256 id = _register(alice);
        assertFalse(reg.isHumanBacked(id));
        assertFalse(reg.isHumanBacked(999)); // nonexistent agent
    }

    // --- authorization ---

    function test_onlyAgentOwnerCanBind() public {
        uint256 id = _register(alice);
        uint256[8] memory p = _mintBindProof(id, mallory, ALICE_NULL, 1);
        vm.prank(mallory);
        vm.expectRevert(HumanBindingRegistry.NotAgentOwner.selector);
        reg.bind(id, ALICE_NULL, ts, p);
    }

    function test_cannotBindTwice() public {
        uint256 id = _register(alice);
        _bind(alice, id, ALICE_NULL, 1);
        uint256[8] memory p = _mintBindProof(id, alice, BOB_NULL, 2);
        vm.prank(alice);
        vm.expectRevert(HumanBindingRegistry.AlreadyBound.selector);
        reg.bind(id, BOB_NULL, ts, p);
    }

    // --- replay protection ---

    function test_proofForAgentACannotBindAgentB() public {
        uint256 a = _register(alice);
        uint256 b = _register(alice);
        uint256[8] memory p = _mintBindProof(a, alice, ALICE_NULL, 1);
        vm.prank(alice);
        vm.expectRevert(HumanBindingRegistry.InvalidProof.selector);
        reg.bind(b, ALICE_NULL, ts, p);
    }

    function test_proofCannotBeReplayedOnOtherChain() public {
        uint256 id = _register(alice);
        uint256[8] memory p = _mintBindProof(id, alice, ALICE_NULL, 1);
        vm.chainId(43113);
        vm.prank(alice);
        vm.expectRevert(HumanBindingRegistry.InvalidProof.selector);
        reg.bind(id, ALICE_NULL, ts, p);
    }

    function test_proofCannotBeReplayedOnOtherRegistry() public {
        uint256 id = _register(alice);
        uint256[8] memory p = _mintBindProof(id, alice, ALICE_NULL, 1);
        HumanBindingRegistry other = new HumanBindingRegistry(
            IAnonAadhaar(address(verifier)), IERC8004Identity(address(ids)), SEED, true, 3, 1 days
        );
        vm.prank(alice);
        vm.expectRevert(HumanBindingRegistry.InvalidProof.selector);
        other.bind(id, ALICE_NULL, ts, p);
    }

    function test_oldProofDeadAfterRevoke() public {
        uint256 id = _register(alice);
        uint256[8] memory p = _mintBindProof(id, alice, ALICE_NULL, 1);
        vm.prank(alice);
        reg.bind(id, ALICE_NULL, ts, p);
        vm.prank(alice);
        reg.revokeByOwner(id);
        // Same calldata again (e.g. an attacker holding the wallet after the human revoked).
        vm.prank(alice);
        vm.expectRevert(HumanBindingRegistry.InvalidProof.selector);
        reg.bind(id, ALICE_NULL, ts, p);
    }

    function test_proofWithOtherSeedRejected() public {
        uint256 id = _register(alice);
        uint256[8] memory p = _proof(1);
        // Human made a proof under a different app's seed => different nullifier.
        verifier.accept(SEED + 1, 333, ts, reg.bindSignal(id, alice), _adultOnly(), p);
        vm.prank(alice);
        vm.expectRevert(HumanBindingRegistry.InvalidProof.selector);
        reg.bind(id, 333, ts, p);
    }

    // --- disclosure policy ---

    function test_proofRevealingExtraFieldsRejected() public {
        uint256 id = _register(alice);
        uint256[8] memory p = _proof(1);
        uint256[4] memory leaky = [uint256(1), 77, 0, 0]; // gender revealed
        verifier.accept(SEED, ALICE_NULL, ts, reg.bindSignal(id, alice), leaky, p);
        vm.prank(alice);
        vm.expectRevert(HumanBindingRegistry.InvalidProof.selector);
        reg.bind(id, ALICE_NULL, ts, p);
    }

    function test_minorRejected() public {
        uint256 id = _register(alice);
        uint256[8] memory p = _proof(1);
        uint256[4] memory minor = [uint256(0), 0, 0, 0];
        verifier.accept(SEED, ALICE_NULL, ts, reg.bindSignal(id, alice), minor, p);
        vm.prank(alice);
        vm.expectRevert(HumanBindingRegistry.InvalidProof.selector);
        reg.bind(id, ALICE_NULL, ts, p);
    }

    function test_zeroNullifierRejected() public {
        uint256 id = _register(alice);
        uint256[8] memory p = _mintBindProof(id, alice, 0, 1);
        vm.prank(alice);
        vm.expectRevert(HumanBindingRegistry.InvalidProof.selector);
        reg.bind(id, 0, ts, p);
    }

    // --- freshness ---

    function test_expiredProofRejected() public {
        uint256 id = _register(alice);
        uint256[8] memory p = _mintBindProof(id, alice, ALICE_NULL, 1);
        vm.warp(ts + 1 days + 1);
        vm.prank(alice);
        vm.expectRevert(HumanBindingRegistry.ProofExpired.selector);
        reg.bind(id, ALICE_NULL, ts, p);
    }

    function test_futureProofRejected() public {
        uint256 id = _register(alice);
        uint256 future = block.timestamp + 2 hours;
        uint256[8] memory p = _proof(1);
        verifier.accept(SEED, ALICE_NULL, future, reg.bindSignal(id, alice), _adultOnly(), p);
        vm.prank(alice);
        vm.expectRevert(HumanBindingRegistry.ProofFromFuture.selector);
        reg.bind(id, ALICE_NULL, future, p);
    }

    // --- Sybil cap ---

    function test_maxAgentsPerHuman() public {
        for (uint256 i; i < 3; i++) {
            uint256 id = _register(alice);
            _bind(alice, id, ALICE_NULL, 10 * (i + 1));
        }
        assertEq(reg.agentsOf(ALICE_NULL), 3);
        uint256 fourth = _register(alice);
        uint256[8] memory p = _mintBindProof(fourth, alice, ALICE_NULL, 99);
        vm.prank(alice);
        vm.expectRevert(HumanBindingRegistry.HumanAgentLimit.selector);
        reg.bind(fourth, ALICE_NULL, ts, p);

        // A different wallet does not help: the cap is per human, not per address.
        uint256 bobs = _register(bob);
        uint256[8] memory q = _mintBindProof(bobs, bob, ALICE_NULL, 98);
        vm.prank(bob);
        vm.expectRevert(HumanBindingRegistry.HumanAgentLimit.selector);
        reg.bind(bobs, ALICE_NULL, ts, q);

        // Revoking one frees a slot.
        vm.prank(alice);
        reg.revokeByOwner(1);
        _bind(alice, fourth, ALICE_NULL, 97);
        assertEq(reg.agentsOf(ALICE_NULL), 3);
    }

    function test_adminCanRaiseCap_othersCannot() public {
        vm.prank(mallory);
        vm.expectRevert(HumanBindingRegistry.NotAdmin.selector);
        reg.setMaxAgentsPerHuman(100);
        reg.setMaxAgentsPerHuman(5);
        assertEq(reg.maxAgentsPerHuman(), 5);
        vm.expectRevert(HumanBindingRegistry.BadConfig.selector);
        reg.setMaxAgentsPerHuman(0);
        vm.expectRevert(HumanBindingRegistry.BadConfig.selector);
        reg.setMaxProofAge(31 days);
    }

    // --- transfer semantics ---

    function test_transferDropsBadge_andNewOwnerCanRebind() public {
        uint256 id = _register(alice);
        _bind(alice, id, ALICE_NULL, 1);
        vm.prank(alice);
        ids.transferFrom(alice, bob, id);
        assertFalse(reg.isHumanBacked(id), "badge must not follow the token");

        // Old owner can no longer revoke (they don't own it); new owner rebinds with own proof.
        _bind(bob, id, BOB_NULL, 2);
        assertTrue(reg.isHumanBacked(id));
        assertEq(reg.agentsOf(ALICE_NULL), 0, "alice's slot freed");
        assertEq(reg.agentsOf(BOB_NULL), 1);
    }

    function test_pruneStale() public {
        uint256 id = _register(alice);
        _bind(alice, id, ALICE_NULL, 1);
        vm.expectRevert(HumanBindingRegistry.NotStale.selector);
        reg.pruneStale(id);
        vm.prank(alice);
        ids.transferFrom(alice, bob, id);
        vm.prank(mallory);
        reg.pruneStale(id);
        assertEq(reg.agentsOf(ALICE_NULL), 0);
    }

    function test_transferBackRestoresOnlyIfStillBound() public {
        uint256 id = _register(alice);
        _bind(alice, id, ALICE_NULL, 1);
        vm.prank(alice);
        ids.transferFrom(alice, bob, id);
        vm.prank(bob);
        ids.transferFrom(bob, alice, id);
        assertTrue(reg.isHumanBacked(id));
    }

    // --- revocation ---

    function test_revokeByOwner() public {
        uint256 id = _register(alice);
        _bind(alice, id, ALICE_NULL, 1);
        vm.prank(mallory);
        vm.expectRevert(HumanBindingRegistry.NotAgentOwner.selector);
        reg.revokeByOwner(id);
        vm.prank(alice);
        reg.revokeByOwner(id);
        assertFalse(reg.isHumanBacked(id));
        assertEq(reg.agentsOf(ALICE_NULL), 0);
        vm.prank(alice);
        vm.expectRevert(HumanBindingRegistry.NotBound.selector);
        reg.revokeByOwner(id);
    }

    function test_revokeByHuman_relayedByAnyone() public {
        uint256 id = _register(alice);
        _bind(alice, id, ALICE_NULL, 1);
        uint256[8] memory p = _proof(500);
        verifier.accept(SEED, ALICE_NULL, ts, reg.revokeSignal(id), _adultOnly(), p);
        vm.prank(mallory); // a relayer
        reg.revokeByHuman(id, ALICE_NULL, ts, p);
        assertFalse(reg.isHumanBacked(id));
    }

    function test_revokeByHuman_wrongHuman() public {
        uint256 id = _register(alice);
        _bind(alice, id, ALICE_NULL, 1);
        uint256[8] memory p = _proof(500);
        verifier.accept(SEED, BOB_NULL, ts, reg.revokeSignal(id), _adultOnly(), p);
        vm.expectRevert(HumanBindingRegistry.NullifierMismatch.selector);
        reg.revokeByHuman(id, BOB_NULL, ts, p);
    }

    function test_bindProofCannotBeUsedToRevoke() public {
        uint256 id = _register(alice);
        uint256[8] memory p = _mintBindProof(id, alice, ALICE_NULL, 1);
        vm.prank(alice);
        reg.bind(id, ALICE_NULL, ts, p);
        vm.expectRevert(HumanBindingRegistry.InvalidProof.selector);
        reg.revokeByHuman(id, ALICE_NULL, ts, p);
    }

    // --- trust anchor ---

    function test_constructorRejectsAnchorMismatch() public {
        MockAnonAadhaar prod = new MockAnonAadhaar(reg.PRODUCTION_PUBKEY_HASH());
        vm.expectRevert(
            abi.encodeWithSelector(HumanBindingRegistry.AnchorMismatch.selector, reg.PRODUCTION_PUBKEY_HASH())
        );
        new HumanBindingRegistry(IAnonAadhaar(address(prod)), IERC8004Identity(address(ids)), SEED, true, 3, 1 days);

        HumanBindingRegistry p = new HumanBindingRegistry(
            IAnonAadhaar(address(prod)), IERC8004Identity(address(ids)), SEED, false, 3, 1 days
        );
        assertFalse(p.isTestAnchor());
    }

    function test_constructorRejectsUnknownAnchor() public {
        MockAnonAadhaar rogue = new MockAnonAadhaar(42);
        vm.expectRevert(abi.encodeWithSelector(HumanBindingRegistry.UnknownAnchor.selector, 42));
        new HumanBindingRegistry(IAnonAadhaar(address(rogue)), IERC8004Identity(address(ids)), SEED, true, 3, 1 days);
    }

    function test_verifierRevertFailsClosed() public {
        RevertingAnonAadhaar bad = new RevertingAnonAadhaar(reg.TEST_PUBKEY_HASH());
        HumanBindingRegistry r =
            new HumanBindingRegistry(IAnonAadhaar(address(bad)), IERC8004Identity(address(ids)), SEED, true, 3, 1 days);
        uint256 id = _register(alice);
        vm.prank(alice);
        vm.expectRevert(HumanBindingRegistry.InvalidProof.selector);
        r.bind(id, ALICE_NULL, ts, _proof(1));
    }

    // --- fuzz ---

    function testFuzz_unregisteredProofNeverBinds(uint256 nullifier, uint256[8] memory p) public {
        uint256 id = _register(alice);
        vm.prank(alice);
        vm.expectRevert(HumanBindingRegistry.InvalidProof.selector);
        reg.bind(id, nullifier, ts, p);
    }
}
