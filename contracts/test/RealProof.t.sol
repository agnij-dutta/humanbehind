// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, stdJson} from "forge-std/Test.sol";
import {HumanBindingRegistry} from "../src/HumanBindingRegistry.sol";
import {AgentIdentityRegistry} from "../src/AgentIdentityRegistry.sol";
import {AnonAadhaar} from "../src/vendor/AnonAadhaar.sol";
import {Verifier} from "../src/vendor/AnonAadhaarGroth16Verifier.sol";

/// @notice End-to-end against the REAL anon-aadhaar groth16 verifier, with real
///         proofs produced by `pnpm fixture` (scripts/prove-fixture.ts) from the
///         fictitious UIDAI sample resident signed with the public test key.
contract RealProofTest is Test {
    using stdJson for string;

    string constant FIXTURE = "./test/fixtures/real-proof.json";

    string json;
    address registryAddr;
    address identityAddr;
    address owner;
    uint256 seed;
    Verifier groth16;

    function setUp() public {
        json = vm.readFile(FIXTURE);
        registryAddr = json.readAddress(".registry");
        identityAddr = json.readAddress(".identity");
        owner = json.readAddress(".owner");
        seed = vm.parseUint(json.readString(".nullifierSeed"));
        groth16 = new Verifier();

        deployCodeTo("AgentIdentityRegistry.sol:AgentIdentityRegistry", identityAddr);
        vm.prank(owner);
        AgentIdentityRegistry(identityAddr).register("ipfs://agent-1"); // agentId 1
        vm.prank(owner);
        AgentIdentityRegistry(identityAddr).register("ipfs://agent-2"); // agentId 2
    }

    function _deployRegistry(bool testAnchor, uint256 maxAgents) internal returns (HumanBindingRegistry) {
        uint256 anchor = testAnchor
            ? 15134874015316324267425466444584014077184337590635665158241104437045239495873
            : 18063425702624337643644061197836918910810808173893535653269228433734128853484;
        AnonAadhaar aa = new AnonAadhaar(address(groth16), anchor);
        deployCodeTo(
            "HumanBindingRegistry.sol:HumanBindingRegistry",
            abi.encode(address(aa), identityAddr, seed, testAnchor, maxAgents, 1 days),
            registryAddr
        );
        return HumanBindingRegistry(registryAddr);
    }

    function _proof(string memory key)
        internal
        view
        returns (uint256 nullifier, uint256 timestamp, uint256[8] memory packed)
    {
        nullifier = vm.parseUint(json.readString(string.concat(key, ".nullifier")));
        timestamp = vm.parseUint(json.readString(string.concat(key, ".timestamp")));
        string[] memory p = json.readStringArray(string.concat(key, ".packed"));
        for (uint256 i; i < 8; i++) {
            packed[i] = vm.parseUint(p[i]);
        }
    }

    function test_real_signalMatchesOffchainComputation() public {
        HumanBindingRegistry reg = _deployRegistry(true, 3);
        uint256 expected = vm.parseUint(json.readString(".bind.signal"));
        assertEq(reg.bindSignal(1, owner), expected);
    }

    function test_real_bind_and_humanRevoke() public {
        HumanBindingRegistry reg = _deployRegistry(true, 3);
        (uint256 n, uint256 ts, uint256[8] memory p) = _proof(".bind");
        vm.warp(ts + 10 minutes);

        uint256 g = gasleft();
        vm.prank(owner);
        reg.bind(1, n, ts, p);
        emit log_named_uint("bind gas (incl. groth16 verify)", g - gasleft());

        assertTrue(reg.isHumanBacked(1));
        HumanBindingRegistry.Attestation memory a = reg.attestation(1);
        assertEq(a.nullifier, n);
        assertTrue(a.ageAbove18);
        assertTrue(a.testAnchor);

        // The human revokes with a second real proof (signal = revokeSignal at nonce 1).
        (uint256 rn, uint256 rts, uint256[8] memory rp) = _proof(".revoke");
        assertEq(rn, n, "same human, same seed => same nullifier");
        reg.revokeByHuman(1, rn, rts, rp);
        assertFalse(reg.isHumanBacked(1));
    }

    function test_real_proofCannotBindDifferentAgent() public {
        HumanBindingRegistry reg = _deployRegistry(true, 3);
        (uint256 n, uint256 ts, uint256[8] memory p) = _proof(".bind");
        vm.warp(ts + 10 minutes);
        vm.prank(owner);
        vm.expectRevert(HumanBindingRegistry.InvalidProof.selector);
        reg.bind(2, n, ts, p);
    }

    function test_real_tamperedProofRejected() public {
        HumanBindingRegistry reg = _deployRegistry(true, 3);
        (uint256 n, uint256 ts, uint256[8] memory p) = _proof(".bind");
        vm.warp(ts + 10 minutes);
        p[7] = p[7] ^ 1;
        vm.prank(owner);
        vm.expectRevert(HumanBindingRegistry.InvalidProof.selector);
        reg.bind(1, n, ts, p);
    }

    function test_real_forgedNullifierRejected() public {
        HumanBindingRegistry reg = _deployRegistry(true, 3);
        (uint256 n, uint256 ts, uint256[8] memory p) = _proof(".bind");
        vm.warp(ts + 10 minutes);
        vm.prank(owner);
        vm.expectRevert(HumanBindingRegistry.InvalidProof.selector);
        reg.bind(1, n + 1, ts, p); // try to dodge the per-human cap with a fake nullifier
    }

    function test_real_secondHumanHasDifferentNullifier() public {
        if (!vm.keyExistsJson(json, ".otherHuman.nullifier")) return;
        HumanBindingRegistry reg = _deployRegistry(true, 3);
        (uint256 n1,,) = _proof(".bind");
        (uint256 n2, uint256 ts, uint256[8] memory p) = _proof(".otherHuman");
        assertTrue(n1 != n2);
        vm.warp(ts + 10 minutes);
        vm.prank(owner);
        reg.bind(1, n2, ts, p);
        assertEq(reg.agentsOf(n2), 1);
        assertEq(reg.agentsOf(n1), 0);
    }

    /// The zkdir lesson: a proof made with the public TEST key must never pass
    /// a production deployment. There is no flag to flip; the anchor is baked in.
    function test_real_testProofRejectedByProductionDeployment() public {
        HumanBindingRegistry reg = _deployRegistry(false, 3);
        assertFalse(reg.isTestAnchor());
        (uint256 n, uint256 ts, uint256[8] memory p) = _proof(".bind");
        vm.warp(ts + 10 minutes);
        vm.prank(owner);
        vm.expectRevert(HumanBindingRegistry.InvalidProof.selector);
        reg.bind(1, n, ts, p);
    }

    function test_real_expiredProofRejected() public {
        HumanBindingRegistry reg = _deployRegistry(true, 3);
        (uint256 n, uint256 ts, uint256[8] memory p) = _proof(".bind");
        vm.warp(ts + 1 days + 1);
        vm.prank(owner);
        vm.expectRevert(HumanBindingRegistry.ProofExpired.selector);
        reg.bind(1, n, ts, p);
    }
}
