import type { SignerWithAddress } from '@enzymefinance/hardhat';
import type { ComptrollerLib, ExternalPositionManager, VaultLib } from '@enzymefinance/protocol';
import { ArbitraryLoanPositionLib, StandardToken } from '@enzymefinance/protocol';
import type { ProtocolDeployment } from '@enzymefinance/testutils';
import {
  arbitraryLoanPositionCloseLoan,
  arbitraryLoanPositionConfigureLoan,
  arbitraryLoanPositionReconcile,
  arbitraryLoanPositionUpdateBorrowableAmount,
  assertEvent,
  createArbitraryLoanPosition,
  createNewFund,
  deployProtocolFixture,
  getAssetUnit,
} from '@enzymefinance/testutils';
import { BigNumber, constants, utils } from 'ethers';

let externalPositionManager: ExternalPositionManager;
let comptrollerProxy: ComptrollerLib, vaultProxy: VaultLib;
let fundOwner: SignerWithAddress, borrower: SignerWithAddress, randomUser: SignerWithAddress;

let fork: ProtocolDeployment;

beforeEach(async () => {
  fork = await deployProtocolFixture();
  [fundOwner, borrower, randomUser] = fork.accounts;

  externalPositionManager = fork.deployment.externalPositionManager;

  const newFundRes = await createNewFund({
    denominationAsset: new StandardToken(fork.config.primitives.usdc, provider),
    fundDeployer: fork.deployment.fundDeployer,
    fundOwner,
    signer: fundOwner,
  });

  comptrollerProxy = newFundRes.comptrollerProxy;
  vaultProxy = newFundRes.vaultProxy;
});

describe('init', () => {
  it('happy path', async () => {
    const { receipt } = await createArbitraryLoanPosition({
      comptrollerProxy,
      externalPositionManager,
      signer: fundOwner,
    });

    expect(receipt).toMatchInlineGasSnapshot('478464');
  });
});

describe('manager actions', () => {
  let arbitraryLoanPosition: ArbitraryLoanPositionLib;
  let loanAsset: StandardToken;

  beforeEach(async () => {
    const arbitraryLoanPositionProxy = (
      await createArbitraryLoanPosition({
        comptrollerProxy,
        externalPositionManager,
        signer: fundOwner,
      })
    ).externalPositionProxy;

    arbitraryLoanPosition = new ArbitraryLoanPositionLib(arbitraryLoanPositionProxy, provider);

    loanAsset = new StandardToken(fork.config.primitives.usdc, whales.usdc);

    // Seed vaults with asset
    const assetUnit = await getAssetUnit(loanAsset);

    await loanAsset.transfer(vaultProxy, assetUnit.mul(10));
  });

  describe('ConfigureLoan', () => {
    const amount = BigNumber.from(123);
    const accountingModule = constants.AddressZero;
    const accountingModuleConfigData = '0x';
    const description = 'test';

    it('does not allow calling on an already-opened loan', async () => {
      await arbitraryLoanPositionConfigureLoan({
        comptrollerProxy,
        externalPositionManager,
        signer: fundOwner,
        externalPositionProxy: arbitraryLoanPosition,
        borrower,
        loanAsset,
        amount,
        accountingModule,
        accountingModuleConfigData,
        description,
      });

      // Second call should fail
      await expect(
        arbitraryLoanPositionConfigureLoan({
          comptrollerProxy,
          externalPositionManager,
          signer: fundOwner,
          externalPositionProxy: arbitraryLoanPosition,
          borrower,
          loanAsset,
          amount,
          accountingModule,
          accountingModuleConfigData,
          description,
        }),
      ).rejects.toBeRevertedWith('Already configured');
    });

    it('does not allow an empty borrower', async () => {
      await expect(
        arbitraryLoanPositionConfigureLoan({
          comptrollerProxy,
          externalPositionManager,
          signer: fundOwner,
          externalPositionProxy: arbitraryLoanPosition,
          borrower: constants.AddressZero,
          loanAsset,
          amount,
          accountingModule,
          accountingModuleConfigData,
          description,
        }),
      ).rejects.toBeRevertedWith('Empty borrower');
    });

    it('does not allow an empty loan asset', async () => {
      await expect(
        arbitraryLoanPositionConfigureLoan({
          comptrollerProxy,
          externalPositionManager,
          signer: fundOwner,
          externalPositionProxy: arbitraryLoanPosition,
          borrower,
          loanAsset: constants.AddressZero,
          amount: 0,
          accountingModule,
          accountingModuleConfigData,
          description,
        }),
      ).rejects.toBeRevertedWith('Empty loan asset');
    });

    // Accounting modules tested in separate files
    it('happy path: no accounting module', async () => {
      const receipt = await arbitraryLoanPositionConfigureLoan({
        comptrollerProxy,
        externalPositionManager,
        signer: fundOwner,
        externalPositionProxy: arbitraryLoanPosition,
        borrower,
        loanAsset,
        amount,
        accountingModule,
        accountingModuleConfigData,
        description,
      });

      expect(await arbitraryLoanPosition.getBorrower()).toMatchAddress(borrower);
      expect(await arbitraryLoanPosition.getLoanAsset()).toMatchAddress(loanAsset);
      expect(await arbitraryLoanPosition.getAccountingModule()).toMatchAddress(accountingModule);
      expect(await arbitraryLoanPosition.getBorrowableAmount()).toEqBigNumber(amount);

      // Total borrowed and repaid should be empty
      expect(await arbitraryLoanPosition.getTotalBorrowed()).toEqBigNumber(0);
      expect(await arbitraryLoanPosition.getTotalRepaid()).toEqBigNumber(0);

      // Position value should be the borrowable amount only
      expect(await arbitraryLoanPosition.getManagedAssets.args().call()).toMatchFunctionOutput(
        arbitraryLoanPosition.getManagedAssets,
        {
          assets_: [loanAsset],
          amounts_: [amount],
        },
      );

      // Assert events
      assertEvent(receipt, arbitraryLoanPosition.abi.getEvent('LoanConfigured'), {
        borrower,
        loanAsset,
        accountingModule,
        description: utils.formatBytes32String(description),
      });
      assertEvent(receipt, arbitraryLoanPosition.abi.getEvent('BorrowableAmountUpdated'), {
        borrowableAmount: amount,
      });

      expect(receipt).toMatchInlineGasSnapshot('233731');
    });
  });

  describe('UpdateBorrowableAmount', () => {
    const initialAmount = BigNumber.from(123);
    const accountingModule = constants.AddressZero;
    const accountingModuleConfigData = '0x';
    const description = 'test';

    beforeEach(async () => {
      await arbitraryLoanPositionConfigureLoan({
        comptrollerProxy,
        externalPositionManager,
        signer: fundOwner,
        externalPositionProxy: arbitraryLoanPosition,
        borrower,
        loanAsset,
        amount: initialAmount,
        accountingModule,
        accountingModuleConfigData,
        description,
      });
    });

    it('does not allow if loan closed', async () => {
      await arbitraryLoanPositionCloseLoan({
        comptrollerProxy,
        externalPositionManager,
        signer: fundOwner,
        externalPositionProxy: arbitraryLoanPosition,
      });

      await expect(
        arbitraryLoanPositionUpdateBorrowableAmount({
          comptrollerProxy,
          externalPositionManager,
          signer: fundOwner,
          externalPositionProxy: arbitraryLoanPosition,
          amountDelta: 1,
        }),
      ).rejects.toBeRevertedWith('Loan closed');
    });

    it('happy path: increase', async () => {
      const amountToAdd = BigNumber.from(2);

      const receipt = await arbitraryLoanPositionUpdateBorrowableAmount({
        comptrollerProxy,
        externalPositionManager,
        signer: fundOwner,
        externalPositionProxy: arbitraryLoanPosition,
        amountDelta: amountToAdd,
      });

      // Borrowable amount should be updated
      const nextBorrowableAmount = initialAmount.add(amountToAdd);
      expect(await arbitraryLoanPosition.getBorrowableAmount()).toEqBigNumber(nextBorrowableAmount);
      expect(await loanAsset.balanceOf(arbitraryLoanPosition)).toEqBigNumber(nextBorrowableAmount);

      // Assert event
      assertEvent(receipt, arbitraryLoanPosition.abi.getEvent('BorrowableAmountUpdated'), {
        borrowableAmount: nextBorrowableAmount,
      });

      expect(receipt).toMatchInlineGasSnapshot('149050');
    });

    it('happy path: decrease', async () => {
      const amountToRemove = BigNumber.from(2);

      const preTxVaultBalance = await loanAsset.balanceOf(vaultProxy);

      const receipt = await arbitraryLoanPositionUpdateBorrowableAmount({
        comptrollerProxy,
        externalPositionManager,
        signer: fundOwner,
        externalPositionProxy: arbitraryLoanPosition,
        amountDelta: -amountToRemove,
      });

      // Borrowable amount should be updated
      const nextBorrowableAmount = initialAmount.sub(amountToRemove);
      expect(await arbitraryLoanPosition.getBorrowableAmount()).toEqBigNumber(nextBorrowableAmount);
      expect(await loanAsset.balanceOf(arbitraryLoanPosition)).toEqBigNumber(nextBorrowableAmount);

      // Removed amount should be sent to the VaultProxy
      expect(await loanAsset.balanceOf(vaultProxy)).toEqBigNumber(preTxVaultBalance.add(amountToRemove));

      // Assert event
      assertEvent(receipt, arbitraryLoanPosition.abi.getEvent('BorrowableAmountUpdated'), {
        borrowableAmount: nextBorrowableAmount,
      });

      expect(receipt).toMatchInlineGasSnapshot('148887');
    });
  });

  describe('CloseLoan', () => {
    beforeEach(async () => {
      const borrowableAmount = (await loanAsset.balanceOf(vaultProxy)).div(4);

      await arbitraryLoanPositionConfigureLoan({
        comptrollerProxy,
        externalPositionManager,
        signer: fundOwner,
        externalPositionProxy: arbitraryLoanPosition,
        borrower,
        loanAsset,
        amount: borrowableAmount,
        accountingModule: constants.AddressZero,
        accountingModuleConfigData: '0x',
      });

      // Borrow some of the available amount
      await arbitraryLoanPosition.connect(borrower).borrow(borrowableAmount.div(4));
    });

    it('cannot be called more than once', async () => {
      await arbitraryLoanPositionCloseLoan({
        comptrollerProxy,
        externalPositionManager,
        signer: fundOwner,
        externalPositionProxy: arbitraryLoanPosition,
      });

      await expect(
        arbitraryLoanPositionCloseLoan({
          comptrollerProxy,
          externalPositionManager,
          signer: fundOwner,
          externalPositionProxy: arbitraryLoanPosition,
        }),
      ).rejects.toBeRevertedWith('Loan closed');
    });

    it('happy path', async () => {
      const extraAsset = new StandardToken(fork.config.primitives.mln, whales.mln);
      const wrappedNativeAsset = new StandardToken(fork.config.wrappedNativeAsset, provider);

      const totalBorrowed = await arbitraryLoanPosition.getTotalBorrowed();
      const totalRepaid = await arbitraryLoanPosition.getTotalRepaid();
      const borrowableAmount = await arbitraryLoanPosition.getBorrowableAmount();

      const loanAssetAmount = totalBorrowed.div(4);
      const nativeAssetAmount = 123;
      const extraAssetAmount = 456;

      // Transfer some of the borrowed amount back to the EP
      await loanAsset.transfer(arbitraryLoanPosition, loanAssetAmount);

      // Transfer some of the native asset to the EP
      await borrower.sendTransaction({
        to: arbitraryLoanPosition.address,
        value: nativeAssetAmount,
      });

      // Transfer another misc asset to the EP
      await extraAsset.transfer(arbitraryLoanPosition, extraAssetAmount);

      // The loan should not yet be marked as closed
      expect(await arbitraryLoanPosition.loanIsClosed()).toBe(false);

      const preTxVaultLoanAssetBalance = await loanAsset.balanceOf(vaultProxy);
      const preTxVaultNativeAssetBalance = await wrappedNativeAsset.balanceOf(vaultProxy);
      const preTxVaultExtraAssetBalance = await extraAsset.balanceOf(vaultProxy);

      const receipt = await arbitraryLoanPositionCloseLoan({
        comptrollerProxy,
        externalPositionManager,
        signer: fundOwner,
        externalPositionProxy: arbitraryLoanPosition,
        extraAssetsToSweep: [wrappedNativeAsset, extraAsset],
      });

      // Assert local storage and events
      expect(await arbitraryLoanPosition.loanIsClosed()).toBe(true);
      expect(await arbitraryLoanPosition.getBorrowableAmount()).toEqBigNumber(0);

      assertEvent(receipt, arbitraryLoanPosition.abi.getEvent('LoanClosed'));

      // The loan's face value should now be 0, even though there is an outstanding balance
      expect(await arbitraryLoanPosition.getTotalBorrowed()).toBeGtBigNumber(
        await arbitraryLoanPosition.getTotalRepaid(),
      );
      expect(await arbitraryLoanPosition.getManagedAssets.call()).toMatchFunctionOutput(
        arbitraryLoanPosition.getManagedAssets,
        {
          assets_: [],
          amounts_: [],
        },
      );

      // The transferred loan asset amount should have been counted as a repayment and sent to the vault
      expect(await arbitraryLoanPosition.getTotalRepaid()).toEqBigNumber(totalRepaid.add(loanAssetAmount));

      // The assets should all have been sent to the vault (with the native asset wrapped)
      expect(await wrappedNativeAsset.balanceOf(vaultProxy)).toEqBigNumber(
        preTxVaultNativeAssetBalance.add(nativeAssetAmount),
      );
      // Transferred loan asset also includes the remaining borrowable amount
      expect(await loanAsset.balanceOf(vaultProxy)).toEqBigNumber(
        preTxVaultLoanAssetBalance.add(borrowableAmount).add(loanAssetAmount),
      );
      expect(await extraAsset.balanceOf(vaultProxy)).toEqBigNumber(preTxVaultExtraAssetBalance.add(extraAssetAmount));
    });
  });

  // Mostly covered by CloseLoan tests, but can still test that encoded action args are handled correctly
  describe('Reconcile', () => {
    it('happy path', async () => {
      // It is enough to just test that a specified extra asset was sent to the vault

      await arbitraryLoanPositionConfigureLoan({
        comptrollerProxy,
        externalPositionManager,
        signer: fundOwner,
        externalPositionProxy: arbitraryLoanPosition,
        borrower,
        loanAsset,
        amount: 0,
        accountingModule: constants.AddressZero,
        accountingModuleConfigData: '0x',
      });

      const extraAsset = new StandardToken(fork.config.primitives.mln, whales.mln);
      const extraAssetAmount = 456;

      // Transfer a misc asset to the EP
      await extraAsset.transfer(arbitraryLoanPosition, extraAssetAmount);

      const preTxVaultExtraAssetBalance = await extraAsset.balanceOf(vaultProxy);

      await arbitraryLoanPositionReconcile({
        comptrollerProxy,
        externalPositionManager,
        signer: fundOwner,
        externalPositionProxy: arbitraryLoanPosition,
        extraAssetsToSweep: [extraAsset],
      });

      // The extra asset should all have been sent to the vault (with the native asset wrapped)
      expect(await extraAsset.balanceOf(vaultProxy)).toEqBigNumber(preTxVaultExtraAssetBalance.add(extraAssetAmount));
    });
  });
});

describe('borrower actions', () => {
  let arbitraryLoanPosition: ArbitraryLoanPositionLib;
  let loanAsset: StandardToken;

  beforeEach(async () => {
    const arbitraryLoanPositionProxy = (
      await createArbitraryLoanPosition({
        comptrollerProxy,
        externalPositionManager,
        signer: fundOwner,
      })
    ).externalPositionProxy;

    arbitraryLoanPosition = new ArbitraryLoanPositionLib(arbitraryLoanPositionProxy, provider);

    loanAsset = new StandardToken(fork.config.primitives.usdc, whales.usdc);

    // Seed vaults with asset
    const assetUnit = await getAssetUnit(loanAsset);
    const seedAmount = assetUnit.mul(1000);
    await loanAsset.transfer(vaultProxy, seedAmount);

    // Configure a loan
    const borrowableAmount = seedAmount.div(4);

    await arbitraryLoanPositionConfigureLoan({
      comptrollerProxy,
      externalPositionManager,
      signer: fundOwner,
      externalPositionProxy: arbitraryLoanPosition,
      borrower,
      loanAsset,
      amount: borrowableAmount,
      accountingModule: constants.AddressZero,
      accountingModuleConfigData: '0x',
      description: '',
    });
  });

  describe('borrow', () => {
    it('does not allow an unauthorized caller', async () => {
      await expect(arbitraryLoanPosition.connect(randomUser).borrow(1)).rejects.toBeRevertedWith('Unauthorized');
    });

    it('does not allow an empty _amount', async () => {
      await expect(arbitraryLoanPosition.connect(borrower).borrow(0)).rejects.toBeRevertedWith('Empty _amount');
    });

    it('happy path: partial amount then full amount', async () => {
      const borrowableAmount = await arbitraryLoanPosition.getBorrowableAmount();
      const partialBorrowAmount = borrowableAmount.div(4);
      expect(partialBorrowAmount).toBeGtBigNumber(0);

      const initialBorrowerBalance = await loanAsset.balanceOf(borrower);

      // Borrow a partial amount
      const receipt1 = await arbitraryLoanPosition.connect(borrower).borrow(partialBorrowAmount);

      // Partial amount should have been transferred to the borrower
      expect(await loanAsset.balanceOf(borrower)).toEqBigNumber(initialBorrowerBalance.add(partialBorrowAmount));

      // Assert loan storage
      const borrowableAmountRemaining = borrowableAmount.sub(partialBorrowAmount);
      expect(await arbitraryLoanPosition.getBorrowableAmount()).toEqBigNumber(borrowableAmountRemaining);
      expect(await arbitraryLoanPosition.getTotalBorrowed()).toEqBigNumber(partialBorrowAmount);

      // Assert event emission
      assertEvent(receipt1, 'TotalBorrowedUpdated', { totalBorrowed: partialBorrowAmount });

      // Borrow a second time, for the remainder
      const receipt2 = await arbitraryLoanPosition.connect(borrower).borrow(borrowableAmountRemaining);

      // Full amount should now have been transferred to the borrower
      expect(await loanAsset.balanceOf(borrower)).toEqBigNumber(initialBorrowerBalance.add(borrowableAmount));

      // Assert loan storage for the full amount
      expect(await arbitraryLoanPosition.getBorrowableAmount()).toEqBigNumber(0);
      expect(await arbitraryLoanPosition.getTotalBorrowed()).toEqBigNumber(borrowableAmount);

      // Assert event emission
      assertEvent(receipt2, 'TotalBorrowedUpdated', { totalBorrowed: borrowableAmount });

      expect(receipt1).toMatchInlineGasSnapshot('122243');
      expect(receipt2).toMatchInlineGasSnapshot('78443');
    });
  });

  describe('repay', () => {
    beforeEach(async () => {
      const borrowableAmount = await arbitraryLoanPosition.getBorrowableAmount();
      const partialBorrowAmount = borrowableAmount.div(4);
      expect(partialBorrowAmount).toBeGtBigNumber(0);

      // Borrow a partial amount
      await arbitraryLoanPosition.connect(borrower).borrow(partialBorrowAmount);

      // Max approve EP for repayment
      await loanAsset.connect(borrower).approve(arbitraryLoanPosition, constants.MaxUint256);
    });

    it('does not allow an empty repay amount', async () => {
      await expect(arbitraryLoanPosition.connect(borrower).repay(0)).rejects.toBeRevertedWith('Nothing to repay');
    });

    it('happy path: partial repayment, then max repayment', async () => {
      const totalBorrowed = await arbitraryLoanPosition.getTotalBorrowed();
      const partialRepayAmount = totalBorrowed.div(4);
      expect(partialRepayAmount).toBeGtBigNumber(0);

      const initialVaultBalance = await loanAsset.balanceOf(vaultProxy);

      // Repay a partial amount
      const receipt1 = await arbitraryLoanPosition.connect(borrower).repay(partialRepayAmount);

      // Partial amount should have been transferred to the VaultProxy
      expect(await loanAsset.balanceOf(vaultProxy)).toEqBigNumber(initialVaultBalance.add(partialRepayAmount));

      // Assert loan storage
      expect(await arbitraryLoanPosition.getTotalRepaid()).toEqBigNumber(partialRepayAmount);

      // Assert event emission
      assertEvent(receipt1, 'TotalRepaidUpdated', { totalRepaid: partialRepayAmount });

      // Repay a second time, for the max amount
      const receipt2 = await arbitraryLoanPosition.connect(borrower).repay(constants.MaxUint256);

      // Full borrowed amount should now be repaid

      // Full amount should have been transferred to the VaultProxy
      expect(await loanAsset.balanceOf(vaultProxy)).toEqBigNumber(initialVaultBalance.add(totalBorrowed));

      // Assert loan storage
      expect(await arbitraryLoanPosition.getTotalRepaid()).toEqBigNumber(totalBorrowed);

      // Assert event emission
      assertEvent(receipt2, 'TotalRepaidUpdated', { totalRepaid: totalBorrowed });

      // EP balance should still be the total borrowable amount (i.e., tokens were transferred from borrower, not EP)
      expect(await loanAsset.balanceOf(arbitraryLoanPosition)).toEqBigNumber(
        await arbitraryLoanPosition.getBorrowableAmount(),
      );

      expect(receipt1).toMatchInlineGasSnapshot('88309');
      expect(receipt2).toMatchInlineGasSnapshot('84103');
    });
  });
});

describe('position value', () => {
  let arbitraryLoanPosition: ArbitraryLoanPositionLib;
  let loanAsset: StandardToken;

  beforeEach(async () => {
    const arbitraryLoanPositionProxy = (
      await createArbitraryLoanPosition({
        comptrollerProxy,
        externalPositionManager,
        signer: fundOwner,
      })
    ).externalPositionProxy;

    arbitraryLoanPosition = new ArbitraryLoanPositionLib(arbitraryLoanPositionProxy, provider);

    loanAsset = new StandardToken(fork.config.primitives.usdc, whales.usdc);

    // Seed vaults with asset
    const assetUnit = await getAssetUnit(loanAsset);
    await loanAsset.transfer(vaultProxy, assetUnit.mul(1000));
  });

  describe('getManagedAssets', () => {
    it('happy path: positive loan balance and borrowable amount', async () => {
      const borrowableAmount = await loanAsset.balanceOf(vaultProxy);

      await arbitraryLoanPositionConfigureLoan({
        comptrollerProxy,
        externalPositionManager,
        signer: fundOwner,
        externalPositionProxy: arbitraryLoanPosition,
        borrower,
        loanAsset,
        amount: borrowableAmount,
        accountingModule: constants.AddressZero,
        accountingModuleConfigData: '0x',
        description: '',
      });

      // Borrow a partial amount
      const partialBorrowAmount = borrowableAmount.div(4);
      expect(partialBorrowAmount).toBeGtBigNumber(0);

      await arbitraryLoanPosition.connect(borrower).borrow(partialBorrowAmount);

      // Repay a partial amount
      const partialRepayAmount = partialBorrowAmount.div(4);
      expect(partialRepayAmount).toBeGtBigNumber(0);

      await loanAsset.connect(borrower).approve(arbitraryLoanPosition, partialRepayAmount);
      await arbitraryLoanPosition.connect(borrower).repay(partialRepayAmount);

      // Value should be original borrowable amount (amount borrowed + amount remaining) net repaid amount
      expect(await arbitraryLoanPosition.getManagedAssets.args().call()).toMatchFunctionOutput(
        arbitraryLoanPosition.getManagedAssets,
        {
          assets_: [loanAsset],
          amounts_: [borrowableAmount.sub(partialRepayAmount)],
        },
      );

      expect(await arbitraryLoanPosition.connect(borrower).getManagedAssets()).toMatchInlineGasSnapshot('47695');
    });

    it('happy path: there is no face value or borrowable amount', async () => {
      await arbitraryLoanPositionConfigureLoan({
        comptrollerProxy,
        externalPositionManager,
        signer: fundOwner,
        externalPositionProxy: arbitraryLoanPosition,
        borrower,
        loanAsset,
        amount: 0,
        accountingModule: constants.AddressZero,
        accountingModuleConfigData: '0x',
        description: '',
      });

      expect(await arbitraryLoanPosition.getManagedAssets.args().call()).toMatchFunctionOutput(
        arbitraryLoanPosition.getManagedAssets,
        {
          assets_: [],
          amounts_: [],
        },
      );
    });

    it('happy path: repaid exceeds borrowed', async () => {
      await arbitraryLoanPositionConfigureLoan({
        comptrollerProxy,
        externalPositionManager,
        signer: fundOwner,
        externalPositionProxy: arbitraryLoanPosition,
        borrower,
        loanAsset,
        amount: 0,
        accountingModule: constants.AddressZero,
        accountingModuleConfigData: '0x',
        description: '',
      });

      // Repay without borrowing anything (i.e., repay > borrowed)
      const repayAmount = 123;
      await loanAsset.transfer(borrower, repayAmount);
      await loanAsset.connect(borrower).approve(arbitraryLoanPosition, repayAmount);
      await arbitraryLoanPosition.connect(borrower).repay(repayAmount);

      expect(await arbitraryLoanPosition.getManagedAssets.args().call()).toMatchFunctionOutput(
        arbitraryLoanPosition.getManagedAssets,
        {
          assets_: [],
          amounts_: [],
        },
      );
    });

    // "Happy path: loan is closed" is tested during CloseLoan tests
  });
});