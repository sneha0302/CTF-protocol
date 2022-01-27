import type { CurveLiquidityAdapterArgs } from '@enzymefinance/protocol';
import type { DeployFunction } from 'hardhat-deploy/types';

import { loadConfig } from '../../../../utils/config';

const fn: DeployFunction = async function (hre) {
  const {
    deployments: { deploy, get },
    ethers: { getSigners },
  } = hre;

  const deployer = (await getSigners())[0];
  const config = await loadConfig(hre);
  const integrationManager = await get('IntegrationManager');

  await deploy('CurveLiquidityAdapter', {
    args: [
      integrationManager.address,
      config.curve.addressProvider,
      config.wrappedNativeAsset,
      config.curve.minter,
      config.primitives.crv,
    ] as CurveLiquidityAdapterArgs,
    from: deployer.address,
    linkedData: {
      nonSlippageAdapter: true,
      type: 'ADAPTER',
    },
    log: true,
    skipIfAlreadyDeployed: true,
  });
};

fn.tags = ['Release', 'Adapters', 'CurveLiquidityAdapter'];
fn.dependencies = ['Config', 'IntegrationManager'];

export default fn;
