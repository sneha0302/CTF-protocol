pragma solidity ^0.4.19;

import 'ds-math/math.sol';
import './AssetInterface.sol';

/// @title Asset Contract for creating ERC20 compliant assets.
/// @author Melonport AG <team@melonport.com>
/// @notice Implementation of ERC20 token contract.
contract Asset is DSMath, AssetInterface {

    function transfer(address _to, uint256 _value) returns (bool success) {
        require(balances[msg.sender] >= _value && add(balances[_to], _value) > balances[_to]);
        balances[msg.sender] = sub(balances[msg.sender], _value);
        balances[_to] = add(balances[_to], _value);
        Transfer(msg.sender, _to, _value);
        return true;
    }

    function transferFrom(address _from, address _to, uint256 _value) returns (bool success) {
        require(balances[_from] >= _value && allowed[_from][msg.sender] >= _value && add(balances[_to], _value) > balances[_to]);
        balances[_to] = add(balances[_to], _value);
        balances[_from] = sub(balances[_from], _value);
        allowed[_from][msg.sender] = sub(allowed[_from][msg.sender], _value);
        Transfer(_from, _to, _value);
        return true;
    }

    function balanceOf(address _owner) constant returns (uint256 balance) {
        return balances[_owner];
    }

    function approve(address _spender, uint256 _value) returns (bool success) {
        allowed[msg.sender][_spender] = _value;
        Approval(msg.sender, _spender, _value);
        return true;
    }

    function allowance(address _owner, address _spender) constant returns (uint256 remaining) {
        return allowed[_owner][_spender];
    }

    mapping (address => uint256) balances;

    mapping (address => mapping (address => uint256)) allowed;

    uint256 public totalSupply;

}
