// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Stand-in for the anon-aadhaar verifier. A "proof" is accepted only
///         for the exact public inputs it was registered with, which mirrors
///         the real groth16 check: change any public input and it fails.
contract MockAnonAadhaar {
    uint256 public immutable storedPublicKeyHash;
    mapping(bytes32 => bool) public accepted;

    constructor(uint256 pubkeyHash) {
        storedPublicKeyHash = pubkeyHash;
    }

    function key(
        uint256 nullifierSeed,
        uint256 nullifier,
        uint256 timestamp,
        uint256 signal,
        uint256[4] memory revealArray,
        uint256[8] memory groth16Proof
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(nullifierSeed, nullifier, timestamp, signal, revealArray, groth16Proof));
    }

    function accept(
        uint256 nullifierSeed,
        uint256 nullifier,
        uint256 timestamp,
        uint256 signal,
        uint256[4] memory revealArray,
        uint256[8] memory groth16Proof
    ) external {
        accepted[key(nullifierSeed, nullifier, timestamp, signal, revealArray, groth16Proof)] = true;
    }

    function verifyAnonAadhaarProof(
        uint256 nullifierSeed,
        uint256 nullifier,
        uint256 timestamp,
        uint256 signal,
        uint256[4] calldata revealArray,
        uint256[8] calldata groth16Proof
    ) external view returns (bool) {
        return accepted[key(nullifierSeed, nullifier, timestamp, signal, revealArray, groth16Proof)];
    }
}

/// @notice A verifier that reverts, to check the registry fails closed.
contract RevertingAnonAadhaar {
    uint256 public immutable storedPublicKeyHash;

    constructor(uint256 pubkeyHash) {
        storedPublicKeyHash = pubkeyHash;
    }

    function verifyAnonAadhaarProof(uint256, uint256, uint256, uint256, uint256[4] calldata, uint256[8] calldata)
        external
        pure
        returns (bool)
    {
        revert("boom");
    }
}
