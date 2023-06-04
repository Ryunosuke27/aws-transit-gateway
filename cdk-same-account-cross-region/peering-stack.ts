import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

interface PeeringStackProps extends cdk.StackProps {
  peerEnv: { account: string; region: string };
  tgwA: ec2.CfnTransitGateway;
  tgwB: ec2.CfnTransitGateway;
}

export class PeeringStack extends cdk.Stack {
  public readonly peeringAttachment: ec2.CfnTransitGatewayPeeringAttachment;
  constructor(scope: Construct, id: string, props: PeeringStackProps) {
    super(scope, id, props);

    // Transit Gateway Peering Attachment
    const peeringAttachment = new ec2.CfnTransitGatewayPeeringAttachment(
      this,
      "TransitGatewayPeeringAttachment",
      {
        peerAccountId: props.peerEnv.account,
        peerRegion: props.peerEnv.region,
        peerTransitGatewayId: props.tgwB.attrId,
        transitGatewayId: props.tgwA.attrId,
      }
    );
    this.peeringAttachment = peeringAttachment;
  }
}
