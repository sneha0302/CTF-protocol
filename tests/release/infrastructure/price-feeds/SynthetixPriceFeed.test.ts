import { EthereumTestnetProvider, extractEvent } from '@crestproject/crestproject';
import { MockSynthetixPriceSource, MockSynthetixToken } from '@melonproject/protocol';
import { defaultTestDeployment } from '@melonproject/testutils';
import { constants, utils } from 'ethers';

async function snapshot(provider: EthereumTestnetProvider) {
  const { accounts, deployment, config } = await defaultTestDeployment(provider);

  // Deploy new Synths
  const newSynth1Symbol = 'sMOCK1';
  const newSynth1CurrencyKey = utils.formatBytes32String(newSynth1Symbol);
  const newSynth1 = await MockSynthetixToken.deploy(
    config.deployer,
    'Mock Synth 1',
    newSynth1Symbol,
    18,
    newSynth1CurrencyKey,
  );

  const newSynth2Symbol = 'sMOCK2';
  const newSynth2CurrencyKey = utils.formatBytes32String(newSynth2Symbol);
  const newSynth2 = await MockSynthetixToken.deploy(
    config.deployer,
    'Mock Synth 2',
    newSynth2Symbol,
    18,
    newSynth2CurrencyKey,
  );

  return {
    accounts,
    deployment,
    config,
    newSynth1,
    newSynth1CurrencyKey,
    newSynth2,
    newSynth2CurrencyKey,
  };
}

describe('constructor', () => {
  it('sets state vars', async () => {
    const {
      config: {
        derivatives: { synthetix },
        integratees: {
          synthetix: { addressResolver, susd },
        },
      },
      deployment: { synthetixPriceFeed },
    } = await provider.snapshot(snapshot);

    expect(await synthetixPriceFeed.getAddressResolver()).toMatchAddress(addressResolver);
    expect(await synthetixPriceFeed.getSUSD()).toMatchAddress(susd);

    // TODO: can check this more precisely by calling Synthetix
    for (const synth of Object.values(synthetix)) {
      expect(await synthetixPriceFeed.getCurrencyKeyForSynth(synth)).not.toBe(constants.HashZero);
    }
  });
});

describe('getRatesToUnderlyings', () => {
  it('revert on invalid rate', async () => {
    const {
      config: {
        deployer,
        integratees: {
          synthetix: { exchangeRates },
        },
      },
      deployment: { synthetixPriceFeed },
      newSynth1,
      newSynth1CurrencyKey,
    } = await provider.snapshot(snapshot);

    await synthetixPriceFeed.addSynths([newSynth1]);
    const er = new MockSynthetixPriceSource(exchangeRates, deployer);

    await er.setRate(newSynth1CurrencyKey, '0');

    const getRatesToUnderlyings = synthetixPriceFeed.getRatesToUnderlyings.args(newSynth1).call();

    await expect(getRatesToUnderlyings).rejects.toBeRevertedWith(
      'getRatesToUnderlyings: _derivative rate is not valid',
    );
  });

  it('returns valid rate', async () => {
    const {
      config: {
        deployer,
        integratees: {
          synthetix: { susd, exchangeRates },
        },
      },
      deployment: { synthetixPriceFeed },
      newSynth1,
      newSynth1CurrencyKey,
    } = await provider.snapshot(snapshot);

    await synthetixPriceFeed.addSynths([newSynth1]);
    const expectedRate = utils.parseEther('1');
    const er = new MockSynthetixPriceSource(exchangeRates, deployer);
    await er.setRate(newSynth1CurrencyKey, expectedRate);

    const getRatesToUnderlyings = await synthetixPriceFeed.getRatesToUnderlyings.args(newSynth1).call();

    expect(getRatesToUnderlyings).toMatchFunctionOutput(synthetixPriceFeed.getRatesToUnderlyings.fragment, {
      rates_: [expectedRate],
      underlyings_: [susd],
    });
  });
});

describe('isSupportedAsset', () => {
  it('return false on invalid synth', async () => {
    const {
      deployment: {
        synthetixPriceFeed,
        tokens: { dai },
      },
    } = await provider.snapshot(snapshot);

    const isSupportedAsset = await synthetixPriceFeed.isSupportedAsset(dai);

    expect(isSupportedAsset).toBe(false);
  });

  it('returns true on valid synth', async () => {
    const {
      config: {
        derivatives: {
          synthetix: { sbtc },
        },
      },
      deployment: { synthetixPriceFeed },
    } = await provider.snapshot(snapshot);

    const isSupportedAsset = await synthetixPriceFeed.isSupportedAsset(sbtc);

    expect(isSupportedAsset).toBe(true);
  });
});

describe('synths registry', () => {
  describe('addSynths', () => {
    it('does not allow a random caller', async () => {
      const {
        accounts: [randomUser],
        deployment: { synthetixPriceFeed },
        newSynth1,
        newSynth2,
      } = await provider.snapshot(snapshot);

      await expect(synthetixPriceFeed.connect(randomUser).addSynths([newSynth1, newSynth2])).rejects.toBeRevertedWith(
        'Only the Dispatcher owner can call this function',
      );
    });

    it('does not allow an empty _synths param', async () => {
      const {
        deployment: { synthetixPriceFeed },
      } = await provider.snapshot(snapshot);

      await expect(synthetixPriceFeed.addSynths([])).rejects.toBeRevertedWith('Empty _synths');
    });

    it('does not allow an already-set Synth', async () => {
      const {
        config: {
          derivatives: {
            synthetix: { sbtc },
          },
        },
        deployment: { synthetixPriceFeed },
      } = await provider.snapshot(snapshot);

      await expect(synthetixPriceFeed.addSynths([sbtc])).rejects.toBeRevertedWith('Value already set');
    });

    it.todo('does not allow an asset without a currencyKey');

    it('adds multiple Synths and emits an event per added Synth', async () => {
      const {
        deployment: { synthetixPriceFeed },
        newSynth1,
        newSynth2,
        newSynth1CurrencyKey,
        newSynth2CurrencyKey,
      } = await provider.snapshot(snapshot);

      // The Synths should not be supported assets initially
      expect(await synthetixPriceFeed.isSupportedAsset(newSynth1)).toBe(false);
      expect(await synthetixPriceFeed.isSupportedAsset(newSynth2)).toBe(false);

      // Add the new Synths
      const addSynthsTx = await synthetixPriceFeed.addSynths([newSynth1, newSynth2]);

      // The currencyKey should be stored for each Synth
      expect(await synthetixPriceFeed.getCurrencyKeyForSynth(newSynth1)).toBe(newSynth1CurrencyKey);
      expect(await synthetixPriceFeed.getCurrencyKeyForSynth(newSynth2)).toBe(newSynth2CurrencyKey);
      expect(
        await synthetixPriceFeed.getCurrencyKeysForSynths([newSynth1, newSynth2]),
      ).toMatchFunctionOutput(synthetixPriceFeed.getCurrencyKeysForSynths, [
        newSynth1CurrencyKey,
        newSynth2CurrencyKey,
      ]);

      // The tokens should now be supported assets
      expect(await synthetixPriceFeed.isSupportedAsset(newSynth1)).toBe(true);
      expect(await synthetixPriceFeed.isSupportedAsset(newSynth2)).toBe(true);

      // The correct event should have been emitted for each Synth
      const events = extractEvent(addSynthsTx, 'SynthAdded');
      expect(events.length).toBe(2);
      expect(events[0]).toMatchEventArgs({
        synth: newSynth1,
        currencyKey: newSynth1CurrencyKey,
      });
      expect(events[1]).toMatchEventArgs({
        synth: newSynth2,
        currencyKey: newSynth2CurrencyKey,
      });
    });
  });

  describe('updateSynthCurrencyKeys', () => {
    it('does not allow an empty _synths param', async () => {
      const {
        deployment: { synthetixPriceFeed },
      } = await provider.snapshot(snapshot);

      await expect(synthetixPriceFeed.updateSynthCurrencyKeys([])).rejects.toBeRevertedWith('Empty _synths');
    });

    it('does not allow an unset Synth', async () => {
      const {
        deployment: { synthetixPriceFeed },
        newSynth1,
      } = await provider.snapshot(snapshot);

      await expect(synthetixPriceFeed.updateSynthCurrencyKeys([newSynth1])).rejects.toBeRevertedWith('Synth not set');
    });

    it('does not allow a Synth that has the correct currencyKey', async () => {
      const {
        config: {
          derivatives: {
            synthetix: { sbtc },
          },
        },
        deployment: { synthetixPriceFeed },
      } = await provider.snapshot(snapshot);

      await expect(synthetixPriceFeed.updateSynthCurrencyKeys([sbtc])).rejects.toBeRevertedWith(
        'Synth has correct currencyKey',
      );
    });

    it('updates multiple Synths and emits an event per updated Synth (called by random user)', async () => {
      const {
        accounts: [randomUser],
        deployment: { synthetixPriceFeed },
        newSynth1,
        newSynth2,
        newSynth1CurrencyKey,
        newSynth2CurrencyKey,
      } = await provider.snapshot(snapshot);

      // Add the new Synths so they are supported
      await synthetixPriceFeed.addSynths([newSynth1, newSynth2]);
      expect(await synthetixPriceFeed.isSupportedAsset(newSynth1)).toBe(true);
      expect(await synthetixPriceFeed.isSupportedAsset(newSynth2)).toBe(true);

      // Update the Synth currency keys in Synthetix
      const altSynth1CurrencyKey = utils.formatBytes32String('sMOCK1-ALT');
      const altSynth2CurrencyKey = utils.formatBytes32String('sMOCK2-ALT');
      await newSynth1.setCurrencyKey(altSynth1CurrencyKey);
      await newSynth2.setCurrencyKey(altSynth2CurrencyKey);

      // Update the new Synths (from a random user)
      const updateSynthsTx = await synthetixPriceFeed
        .connect(randomUser)
        .updateSynthCurrencyKeys([newSynth1, newSynth2]);

      // The new currencyKey should be stored for each Synth
      expect(await synthetixPriceFeed.getCurrencyKeyForSynth(newSynth1)).toBe(altSynth1CurrencyKey);
      expect(await synthetixPriceFeed.getCurrencyKeyForSynth(newSynth2)).toBe(altSynth2CurrencyKey);
      expect(
        await synthetixPriceFeed.getCurrencyKeysForSynths([newSynth1, newSynth2]),
      ).toMatchFunctionOutput(synthetixPriceFeed.getCurrencyKeysForSynths, [
        altSynth1CurrencyKey,
        altSynth2CurrencyKey,
      ]);

      // The tokens should still be supported assets
      expect(await synthetixPriceFeed.isSupportedAsset(newSynth1)).toBe(true);
      expect(await synthetixPriceFeed.isSupportedAsset(newSynth2)).toBe(true);

      // The correct event should have been emitted for each Synth
      const events = extractEvent(updateSynthsTx, 'SynthCurrencyKeyUpdated');
      expect(events.length).toBe(2);
      expect(events[0]).toMatchEventArgs({
        synth: newSynth1,
        prevCurrencyKey: newSynth1CurrencyKey,
        nextCurrencyKey: altSynth1CurrencyKey,
      });
      expect(events[1]).toMatchEventArgs({
        synth: newSynth2,
        prevCurrencyKey: newSynth2CurrencyKey,
        nextCurrencyKey: altSynth2CurrencyKey,
      });
    });
  });
});