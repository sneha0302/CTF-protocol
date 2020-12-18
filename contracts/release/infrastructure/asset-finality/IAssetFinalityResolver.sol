// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.6.12;

/// @title IAssetFinalityResolver interface
/// @author Enzyme Council <security@enzyme.finance>
/// @notice Interface for AssetFinalityResolver
interface IAssetFinalityResolver {
    function finalizeAndGetAssetBalance(
        address,
        address,
        bool
    ) external returns (uint256);
}