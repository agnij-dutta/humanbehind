// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {HumanBindingRegistry, IAnonAadhaar, IERC8004Identity} from "../src/HumanBindingRegistry.sol";
import {AgentIdentityRegistry} from "../src/AgentIdentityRegistry.sol";
import {AnonAadhaar} from "../src/vendor/AnonAadhaar.sol";
import {Verifier} from "../src/vendor/AnonAadhaarGroth16Verifier.sol";

/// @notice Deploys the stack with the TEST anchor (local or testnet only).
///   forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key <anvil key>
/// Env (optional):
///   IDENTITY_REGISTRY  reuse an existing ERC-8004 identity registry instead of deploying one
///   ANON_AADHAAR       reuse an existing anon-aadhaar verifier (its anchor must be the test key)
///   MAX_AGENTS         default 3
contract Deploy is Script {
    uint256 constant TEST_PUBKEY_HASH = 15134874015316324267425466444584014077184337590635665158241104437045239495873;

    function run() external {
        uint256 seed = uint256(keccak256("humanbehind.nullifierSeed.v1")) >> 3;
        uint256 maxAgents = vm.envOr("MAX_AGENTS", uint256(3));
        address identity = vm.envOr("IDENTITY_REGISTRY", address(0));
        address aa = vm.envOr("ANON_AADHAAR", address(0));

        vm.startBroadcast();
        if (aa == address(0)) aa = address(new AnonAadhaar(address(new Verifier()), TEST_PUBKEY_HASH));
        if (identity == address(0)) identity = address(new AgentIdentityRegistry());
        HumanBindingRegistry reg =
            new HumanBindingRegistry(IAnonAadhaar(aa), IERC8004Identity(identity), seed, true, maxAgents, 1 days);
        vm.stopBroadcast();

        console2.log("anonAadhaar", aa);
        console2.log("identityRegistry", identity);
        console2.log("bindingRegistry", address(reg));
        console2.log("nullifierSeed", seed);
    }
}
