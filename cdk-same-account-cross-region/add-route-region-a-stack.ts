import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import { RegionBStack } from "./region-b-stack";

interface AddRouteRegionAStackProps extends cdk.StackProps {
  peeringAttachment: ec2.CfnTransitGatewayPeeringAttachment;
}

export class AddRouteRegionAStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AddRouteRegionAStackProps) {
    super(scope, id, props);

    // Transit GatewayのデフォルトルートテーブルはCDKで参照する方法がないため、ハードコーディング
    const TGW_ROUTE_TABLE_ID = "";

    const route = new ec2.CfnTransitGatewayRoute(this, "TransitGatewayRoute", {
      transitGatewayRouteTableId: TGW_ROUTE_TABLE_ID,
      destinationCidrBlock: RegionBStack.CIDR,
      transitGatewayAttachmentId:
        props.peeringAttachment.attrTransitGatewayAttachmentId,
    });
  }
}
