// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract WealthTransferFHE is SepoliaConfig {
    struct EncryptedClientProfile {
        uint256 id;
        euint32 encryptedAssets;
        euint32 encryptedFamilyStructure;
        euint32 encryptedTaxJurisdiction;
        uint256 timestamp;
    }
    
    struct DecryptedClientProfile {
        string assets;
        string familyStructure;
        string taxJurisdiction;
        bool isAnalyzed;
    }

    uint256 public profileCount;
    mapping(uint256 => EncryptedClientProfile) public encryptedProfiles;
    mapping(uint256 => DecryptedClientProfile) public decryptedProfiles;
    
    mapping(string => euint32) private encryptedJurisdictionStats;
    string[] private jurisdictionList;
    
    mapping(uint256 => uint256) private requestToProfileId;
    
    event ProfileSubmitted(uint256 indexed id, uint256 timestamp);
    event AnalysisRequested(uint256 indexed id);
    event ProfileAnalyzed(uint256 indexed id);
    
    modifier onlyAdvisor(uint256 profileId) {
        _;
    }
    
    function submitEncryptedProfile(
        euint32 encryptedAssets,
        euint32 encryptedFamilyStructure,
        euint32 encryptedTaxJurisdiction
    ) public {
        profileCount += 1;
        uint256 newId = profileCount;
        
        encryptedProfiles[newId] = EncryptedClientProfile({
            id: newId,
            encryptedAssets: encryptedAssets,
            encryptedFamilyStructure: encryptedFamilyStructure,
            encryptedTaxJurisdiction: encryptedTaxJurisdiction,
            timestamp: block.timestamp
        });
        
        decryptedProfiles[newId] = DecryptedClientProfile({
            assets: "",
            familyStructure: "",
            taxJurisdiction: "",
            isAnalyzed: false
        });
        
        emit ProfileSubmitted(newId, block.timestamp);
    }
    
    function requestWealthAnalysis(uint256 profileId) public onlyAdvisor(profileId) {
        EncryptedClientProfile storage profile = encryptedProfiles[profileId];
        require(!decryptedProfiles[profileId].isAnalyzed, "Already analyzed");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(profile.encryptedAssets);
        ciphertexts[1] = FHE.toBytes32(profile.encryptedFamilyStructure);
        ciphertexts[2] = FHE.toBytes32(profile.encryptedTaxJurisdiction);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.analyzeWealth.selector);
        requestToProfileId[reqId] = profileId;
        
        emit AnalysisRequested(profileId);
    }
    
    function analyzeWealth(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 profileId = requestToProfileId[requestId];
        require(profileId != 0, "Invalid request");
        
        EncryptedClientProfile storage eProfile = encryptedProfiles[profileId];
        DecryptedClientProfile storage dProfile = decryptedProfiles[profileId];
        require(!dProfile.isAnalyzed, "Already analyzed");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (string memory assets, string memory familyStructure, string memory taxJurisdiction) = 
            abi.decode(cleartexts, (string, string, string));
        
        dProfile.assets = assets;
        dProfile.familyStructure = familyStructure;
        dProfile.taxJurisdiction = taxJurisdiction;
        dProfile.isAnalyzed = true;
        
        if (FHE.isInitialized(encryptedJurisdictionStats[dProfile.taxJurisdiction]) == false) {
            encryptedJurisdictionStats[dProfile.taxJurisdiction] = FHE.asEuint32(0);
            jurisdictionList.push(dProfile.taxJurisdiction);
        }
        encryptedJurisdictionStats[dProfile.taxJurisdiction] = FHE.add(
            encryptedJurisdictionStats[dProfile.taxJurisdiction], 
            FHE.asEuint32(1)
        );
        
        emit ProfileAnalyzed(profileId);
    }
    
    function getDecryptedProfile(uint256 profileId) public view returns (
        string memory assets,
        string memory familyStructure,
        string memory taxJurisdiction,
        bool isAnalyzed
    ) {
        DecryptedClientProfile storage p = decryptedProfiles[profileId];
        return (p.assets, p.familyStructure, p.taxJurisdiction, p.isAnalyzed);
    }
    
    function getEncryptedJurisdictionStats(string memory jurisdiction) public view returns (euint32) {
        return encryptedJurisdictionStats[jurisdiction];
    }
    
    function requestJurisdictionStatsDecryption(string memory jurisdiction) public {
        euint32 stats = encryptedJurisdictionStats[jurisdiction];
        require(FHE.isInitialized(stats), "Jurisdiction not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(stats);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptJurisdictionStats.selector);
        requestToProfileId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(jurisdiction)));
    }
    
    function decryptJurisdictionStats(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 jurisdictionHash = requestToProfileId[requestId];
        string memory jurisdiction = getJurisdictionFromHash(jurisdictionHash);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 stats = abi.decode(cleartexts, (uint32));
    }
    
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
    
    function getJurisdictionFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < jurisdictionList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(jurisdictionList[i]))) == hash) {
                return jurisdictionList[i];
            }
        }
        revert("Jurisdiction not found");
    }
    
    function recommendTransferPlan(
        uint256 profileId,
        string[] memory availableOptions
    ) public view returns (string[] memory recommendedPlans) {
        DecryptedClientProfile storage profile = decryptedProfiles[profileId];
        require(profile.isAnalyzed, "Profile not analyzed");
        
        uint256 count = 0;
        for (uint256 i = 0; i < availableOptions.length; i++) {
            if (isPlanCompatible(profile.assets, profile.familyStructure, profile.taxJurisdiction, availableOptions[i])) {
                count++;
            }
        }
        
        recommendedPlans = new string[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < availableOptions.length; i++) {
            if (isPlanCompatible(profile.assets, profile.familyStructure, profile.taxJurisdiction, availableOptions[i])) {
                recommendedPlans[index] = availableOptions[i];
                index++;
            }
        }
        return recommendedPlans;
    }
    
    function isPlanCompatible(
        string memory assets,
        string memory familyStructure,
        string memory taxJurisdiction,
        string memory plan
    ) private pure returns (bool) {
        // Simplified compatibility check
        // In real implementation, this would analyze all factors
        return true;
    }
    
    function calculateTaxSavings(
        string memory assets,
        string memory plan,
        string memory jurisdiction
    ) public pure returns (uint256 savings) {
        // Simplified tax savings calculation
        // In real implementation, this would use jurisdiction-specific tax rules
        return 1000; // Placeholder value
    }
}