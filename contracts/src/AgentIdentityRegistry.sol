// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title  AgentIdentityRegistry
/// @notice Minimal ERC-8004 Identity Registry for local and testnet use.
///         An ERC-721 where `agentId == tokenId` and the controller is the
///         token owner. `tokenURI(agentId)` resolves to the agent's
///         registration file (ERC-8004 "registration-v1" JSON).
///
/// @dev    Adapted from the Capline/Mandate IdentityRegistry, renamed to the
///         current ERC-8004 draft surface: `register(agentURI)`,
///         `setAgentURI`, `tokenURI`. HumanBindingRegistry only depends on
///         `ownerOf`, so any ERC-8004 registry (which is ERC-721) works.
contract AgentIdentityRegistry {
    string public constant name = "ERC-8004 Agent Identity";
    string public constant symbol = "AGENT";

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;
    mapping(uint256 => string) private _agentURI;

    uint256 public nextAgentId = 1; // 0 reserved

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    /// @notice ERC-8004 registration event.
    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);

    error ZeroAddress();
    error NotOwnerOrApproved();
    error NonexistentToken();
    error WrongFrom();

    function register(string calldata agentURI) external returns (uint256 agentId) {
        agentId = nextAgentId++;
        _owners[agentId] = msg.sender;
        unchecked {
            _balances[msg.sender] += 1;
        }
        _agentURI[agentId] = agentURI;
        emit Transfer(address(0), msg.sender, agentId);
        emit Registered(agentId, agentURI, msg.sender);
    }

    function setAgentURI(uint256 agentId, string calldata newURI) external {
        if (!_isOwnerOrApproved(msg.sender, agentId)) revert NotOwnerOrApproved();
        _agentURI[agentId] = newURI;
        emit URIUpdated(agentId, newURI, msg.sender);
    }

    function tokenURI(uint256 agentId) external view returns (string memory) {
        if (_owners[agentId] == address(0)) revert NonexistentToken();
        return _agentURI[agentId];
    }

    // --- ERC-721 core ---

    function ownerOf(uint256 tokenId) public view returns (address owner) {
        owner = _owners[tokenId];
        if (owner == address(0)) revert NonexistentToken();
    }

    function balanceOf(address owner) external view returns (uint256) {
        if (owner == address(0)) revert ZeroAddress();
        return _balances[owner];
    }

    function getApproved(uint256 tokenId) public view returns (address) {
        if (_owners[tokenId] == address(0)) revert NonexistentToken();
        return _tokenApprovals[tokenId];
    }

    function isApprovedForAll(address owner, address operator) public view returns (bool) {
        return _operatorApprovals[owner][operator];
    }

    function approve(address to, uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        if (msg.sender != owner && !_operatorApprovals[owner][msg.sender]) revert NotOwnerOrApproved();
        _tokenApprovals[tokenId] = to;
        emit Approval(owner, to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        if (to == address(0)) revert ZeroAddress();
        address owner = _owners[tokenId];
        if (owner == address(0)) revert NonexistentToken();
        if (owner != from) revert WrongFrom();
        if (!_isOwnerOrApproved(msg.sender, tokenId)) revert NotOwnerOrApproved();
        delete _tokenApprovals[tokenId];
        unchecked {
            _balances[from] -= 1;
            _balances[to] += 1;
        }
        _owners[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        transferFrom(from, to, tokenId);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 || interfaceId == 0x80ac58cd || interfaceId == 0x5b5e139f;
    }

    function _isOwnerOrApproved(address who, uint256 tokenId) internal view returns (bool) {
        address owner = _owners[tokenId];
        if (owner == address(0)) revert NonexistentToken();
        return who == owner || who == _tokenApprovals[tokenId] || _operatorApprovals[owner][who];
    }
}
