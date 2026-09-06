// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {FairateDeposit} from "../contracts/sol/FairateDeposit.sol";
import {MockUSD} from "../contracts/sol/MockUSD.sol";
import {FairateRateFeed} from "../contracts/sol/FairateRateFeed.sol";
import {MockAggregator} from "./harness/MockAggregator.sol";

contract FairateDepositTest is Test {
    FairateDeposit internal depositContract;
    MockUSD internal stablecoin;
    FairateRateFeed internal rateFeed;
    MockAggregator internal aggregator;

    address internal constant RECEIVER = address(0xB0B);

    event RemittanceDeposited(
        address indexed sender, address indexed receiver, uint256 amount, uint256 depositId
    );

    function setUp() public {
        stablecoin = new MockUSD();
        aggregator = new MockAggregator(2494_20190000, 8); // 2494.20190000, as Sepolia reads today
        rateFeed = new FairateRateFeed(address(aggregator));
        depositContract = new FairateDeposit(address(stablecoin), address(rateFeed));
        stablecoin.approve(address(depositContract), type(uint256).max);
    }

    function testDeposit_emitsEventAndLocksFunds() public {
        uint256 amount = 250 ether;
        uint256 balanceBefore = stablecoin.balanceOf(address(this));

        vm.expectEmit(true, true, false, true);
        emit RemittanceDeposited(address(this), RECEIVER, amount, 0);
        depositContract.deposit(RECEIVER, amount);

        assertEq(stablecoin.balanceOf(address(this)), balanceBefore - amount);
        assertEq(stablecoin.balanceOf(depositContract.LOCK_SINK()), amount);
        // Escrow itself must never hold funds — it is a pass-through to the sink.
        assertEq(stablecoin.balanceOf(address(depositContract)), 0);
    }

    function testDeposit_incrementsDepositId() public {
        depositContract.deposit(RECEIVER, 1 ether);
        depositContract.deposit(RECEIVER, 1 ether);
        assertEq(depositContract.depositCount(), 2);
    }

    function testDeposit_rejectsZeroReceiver() public {
        vm.expectRevert(FairateDeposit.ZeroReceiver.selector);
        depositContract.deposit(address(0), 1 ether);
    }

    function testDeposit_rejectsZeroAmount() public {
        vm.expectRevert(FairateDeposit.ZeroAmount.selector);
        depositContract.deposit(RECEIVER, 0);
    }

    function testDeposit_revertsWithoutApproval() public {
        stablecoin.approve(address(depositContract), 0);
        vm.expectRevert();
        depositContract.deposit(RECEIVER, 1 ether);
    }
}
