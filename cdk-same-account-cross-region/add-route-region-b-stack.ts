import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import { RegionAStack } from "./region-a-stack";

interface AddRouteRegionBStackProps extends cdk.StackProps {
  peeringAttachment: ec2.CfnTransitGatewayPeeringAttachment;
}

export class AddRouteRegionBStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AddRouteRegionBStackProps) {
    super(scope, id, props);

    // Transit GatewayのデフォルトルートテーブルはCDKで参照する方法がないため、ハードコーディング
    const TGW_ROUTE_TABLE_ID = "";

    const route = new ec2.CfnTransitGatewayRoute(this, "TransitGatewayRoute", {
      transitGatewayRouteTableId: TGW_ROUTE_TABLE_ID,
      destinationCidrBlock: RegionAStack.CIDR,
      transitGatewayAttachmentId:
        props.peeringAttachment.attrTransitGatewayAttachmentId,
    });
  }
}
