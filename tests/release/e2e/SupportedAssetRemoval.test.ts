import { extractEvent } from '@enzymefinance/ethers';
import { SignerWithAddress } from '@enzymefinance/hardhat';
import {
  ComptrollerLib,
  feeManagerConfigArgs,
  IntegrationManager,
  performanceFeeConfigArgs,
  RevertingPriceFeed,
  StandardToken,
  UniswapV2Adapter,
  ValueInterpreter,
  VaultLib,
} from '@enzymefinance/protocol';
import { buyShares, createNewFund, redeemSharesInKind, uniswapV2TakeOrder } from '@enzymefinance/testutils';
import { utils } from 'ethers';

// Note: One fork is used for the entire test suite, so test ordering is important

let integrationManager: IntegrationManager,
  revertingPriceFeed: RevertingPriceFeed,
  uniswapV2Adapter: UniswapV2Adapter,
  valueInterpreter: ValueInterpreter;
let denominationAsset: StandardToken, fundOwner: SignerWithAddress;
let comptrollerProxy: ComptrollerLib, vaultProxy: VaultLib;
let tradingAsset: StandardToken;

beforeAll(async () => {
  // System contracts
  integrationManager = fork.deployment.integrationManager;
  revertingPriceFeed = fork.deployment.revertingPriceFeed;
  uniswapV2Adapter = fork.deployment.uniswapV2Adapter;
  valueInterpreter = fork.deployment.valueInterpreter;

  // Fund config and contracts
  denominationAsset = new StandardToken(fork.config.primitives.usdc, whales.usdc);
  [fundOwner] = fork.accounts;

  const newFundRes = await createNewFund({
    signer: fundOwner,
    fundOwner,
    denominationAsset,
    fundDeployer: fork.deployment.fundDeployer,
    // Include PerformanceFee to test reverting behavior when GAV calc fails
    feeManagerConfig: feeManagerConfigArgs({
      fees: [fork.deployment.performanceFee],
      settings: [
        performanceFeeConfigArgs({
          rate: utils.parseEther('.05'),
          period: 1,
        }),
      ],
    }),
    // Invest to seed fund with denomination asset balance
    investment: {
      buyer: fundOwner,
      seedBuyer: true,
    },
  });
  comptrollerProxy = newFundRes.comptrollerProxy;
  vaultProxy = newFundRes.vaultProxy;

  // Misc vars
  tradingAsset = new StandardToken(fork.config.weth, provider);
});

describe('unsupported denomination asset', () => {
  beforeAll(async () => {
    // Remove the denomination asset from supported assets by removing it as a primitive
    await valueInterpreter.removePrimitives([denominationAsset]);
  });

  it('does NOT allow buying shares', async () => {
    await expect(
      buyShares({
        comptrollerProxy,
        buyer: fundOwner,
        denominationAsset,
      }),
    ).rejects.toBeRevertedWith('Unsupported _quoteAsset');
  });

  it('allows trading away the denomination asset', async () => {
    await uniswapV2TakeOrder({
      comptrollerProxy,
      vaultProxy,
      integrationManager,
      fundOwner,
      uniswapV2Adapter,
      path: [denominationAsset, tradingAsset],
      outgoingAssetAmount: (await denominationAsset.balanceOf(vaultProxy)).div(2),
      minIncomingAssetAmount: 1,
    });
  });

  it('does NOT allow trading into the denomination asset', async () => {
    await expect(
      uniswapV2TakeOrder({
        comptrollerProxy,
        vaultProxy,
        integrationManager,
        fundOwner,
        uniswapV2Adapter,
        path: [tradingAsset, denominationAsset],
        outgoingAssetAmount: (await tradingAsset.balanceOf(vaultProxy)).div(2),
        minIncomingAssetAmount: 1,
      }),
    ).rejects.toBeRevertedWith('Non-receivable incoming asset');
  });

  it('allows redeeming shares, with an emitted PreRedeemShares hook failure event', async () => {
    const redeemSharesTx = await redeemSharesInKind({
      comptrollerProxy,
      signer: fundOwner,
      quantity: (await vaultProxy.balanceOf(fundOwner)).div(2),
    });

    const failureEvents = extractEvent(redeemSharesTx as any, 'PreRedeemSharesHookFailed');
    expect(failureEvents.length).toBe(1);
  });
});

describe('denomination asset supported only via RevertingPriceFeed', () => {
  beforeAll(async () => {
    await valueInterpreter.addDerivatives([denominationAsset], [revertingPriceFeed]);
  });

  it('does NOT allow buy shares', async () => {
    await expect(
      buyShares({
        comptrollerProxy,
        buyer: fundOwner,
        denominationAsset,
      }),
    ).rejects.toBeRevertedWith('Unsupported _quoteAsset');
  });

  it('allows trading away the denomination asset', async () => {
    await uniswapV2TakeOrder({
      comptrollerProxy,
      vaultProxy,
      integrationManager,
      fundOwner,
      uniswapV2Adapter,
      path: [denominationAsset, tradingAsset],
      outgoingAssetAmount: (await denominationAsset.balanceOf(vaultProxy)).div(2),
      minIncomingAssetAmount: 1,
    });
  });

  it('allows trading into the denomination asset', async () => {
    await uniswapV2TakeOrder({
      comptrollerProxy,
      vaultProxy,
      integrationManager,
      fundOwner,
      uniswapV2Adapter,
      path: [tradingAsset, denominationAsset],
      outgoingAssetAmount: (await tradingAsset.balanceOf(vaultProxy)).div(2),
      minIncomingAssetAmount: 1,
    });
  });

  it('allows redeeming shares, with an emitted PreRedeemShares hook failure event', async () => {
    const redeemSharesTx = await redeemSharesInKind({
      comptrollerProxy,
      signer: fundOwner,
      quantity: (await vaultProxy.balanceOf(fundOwner)).div(2),
    });

    const failureEvents = extractEvent(redeemSharesTx as any, 'PreRedeemSharesHookFailed');
    expect(failureEvents.length).toBe(1);
  });
});