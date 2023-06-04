import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

export class SameStack extends cdk.Stack {
  private static readonly CIDR1 = "10.0.0.0/16";
  private static readonly CIDR2 = "10.1.0.0/16";
  private static readonly ISOLATED_CIDR_MASK = 24;
  private static readonly TGW_CIDR_MASK = 28;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPCを作成
    const vpc1 = this.createVpc("Vpc1", SameStack.CIDR1);
    const vpc2 = this.createVpc("Vpc2", SameStack.CIDR2);

    // サブネットを抽出
    const tgwSubnet1 = this.selectSubnet(vpc1, SameStack.TGW_CIDR_MASK);
    const tgwSubnet2 = this.selectSubnet(vpc2, SameStack.TGW_CIDR_MASK);
    const isolatedSubnet1 = this.selectSubnet(vpc1, SameStack.ISOLATED_CIDR_MASK);
    const isolatedSubnet2 = this.selectSubnet(vpc2, SameStack.ISOLATED_CIDR_MASK);

    // セキュリティグループを作成
    const sg1 = this.createSg("Sg1", vpc1);
    const sg2 = this.createSg("Sg2", vpc2);

    // EC2インスタンスを作成
    const instance1 = this.createInstance("Instance1", vpc1, sg1);
    const instance2 = this.createInstance("Instance2", vpc2, sg2);

    /*-------------------*
     * 疎通設定
     *-------------------*/
    // Transit Gatewayを作成
    const tgw = new ec2.CfnTransitGateway(this, "Tgw", {});

    // Transit Gateway アタッチメントを作成
    const tgwAttachment1 = this.createTgwAttachment(
      "TgwAttachment1",
      tgwSubnet1,
      tgw,
      vpc1
    );
    const tgwAttachment2 = this.createTgwAttachment(
      "TgwAttachment2",
      tgwSubnet2,
      tgw,
      vpc2
    );

    // VPCルートテーブルにTransit Gatewayへのルートを追加
    const route1 = this.addRoute(
      "One2TwoRoute",
      isolatedSubnet1,
      vpc2.vpcCidrBlock,
      tgw
    );
    const route2 = this.addRoute(
      "Two2OneRoute",
      isolatedSubnet2,
      vpc1.vpcCidrBlock,
      tgw
    );
    route1.addDependsOn(tgwAttachment1);
    route2.addDependsOn(tgwAttachment2);

    // セキュリティグループに互いのインスタンスIPの許可ルール追加
    this.addIngrees("One2TwoIngrees", instance1.instancePrivateIp, sg2);
    this.addIngrees("Two2OneIngrees", instance2.instancePrivateIp, sg1);
  }

  /*--------------------*
   * メソッド
   *--------------------*/

  /**
   * VPCを作成する
   * @param logicalId CloudFormation論理名
   * @param cidr CIDR
   * @returns
   */
  private createVpc(logicalId: string, cidr: string) {
    return new ec2.Vpc(this, logicalId, {
      ipAddresses: ec2.IpAddresses.cidr(cidr),
      maxAzs: 1,
      subnetConfiguration: [
        {
          name: "Isolated",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: SameStack.ISOLATED_CIDR_MASK,
        },
        {
          name: "Tgw",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: SameStack.TGW_CIDR_MASK,
        },
      ],
    });
  }

  /**
   * VPCオブジェクトから任意のサブネットを抽出する
   * @param vpc VPC
   * @param cidrMask CIDRマスク
   * @returns
   */
  private selectSubnet(vpc: ec2.Vpc, cidrMask: number) {
    return vpc.selectSubnets({
      subnetFilters: [ec2.SubnetFilter.byCidrMask(cidrMask)],
    });
  }

  /**
   * セキュリティグループを作成する
   * @param logicalId CloudFormation論理名
   * @param vpc VPC
   * @returns
   */
  private createSg(logicalId: string, vpc: ec2.Vpc) {
    return new ec2.SecurityGroup(this, logicalId, {
      vpc,
    });
  }

  /**
   * EC2インスタンスを作成する
   * @param logicalId CloudFormation論理名
   * @param vpc VPC
   * @param securityGroup セキュリティグループ
   * @returns
   */
  private createInstance(
    logicalId: string,
    vpc: ec2.Vpc,
    securityGroup: ec2.SecurityGroup
  ) {
    return new ec2.Instance(this, logicalId, {
      vpc,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T2,
        ec2.InstanceSize.MICRO
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux(),
      securityGroup,
    });
  }

  /**
   * Transit Gatewayアタッチメントを作成する
   * @param logicalId CloudFormation論理名
   * @param selectedSubnets Transit GatewayのENI用サブネット
   * @param tgw Transit Gateway
   * @param vpc VPC
   * @returns
   */
  private createTgwAttachment(
    logicalId: string,
    selectedSubnets: ec2.SelectedSubnets,
    tgw: ec2.CfnTransitGateway,
    vpc: ec2.Vpc
  ) {
    return new ec2.CfnTransitGatewayAttachment(this, logicalId, {
      subnetIds: selectedSubnets.subnetIds,
      transitGatewayId: tgw.attrId,
      vpcId: vpc.vpcId,
    });
  }

  /**
   * セキュリティグループに互いのインスタンスのプライベートIPの許可ルールを追加する
   * @param logicalId CloudFormation論理名
   * @param privateIp インスタンスのプライベートIP
   * @param sg ルール追加対象のセキュリティグループ
   */
  private addIngrees(
    logicalId: string,
    privateIp: string,
    sg: ec2.SecurityGroup
  ) {
    new ec2.CfnSecurityGroupIngress(this, logicalId, {
      ipProtocol: "tcp",
      cidrIp: `${privateIp}/32`,
      fromPort: 0,
      toPort: 65535,
      groupId: sg.securityGroupId,
    });
  }

  /**
   * Transit Gatewayへのルートを追加する
   * @param logicalId CloudFormation論理名
   * @param srcSubnet ルートを追加するテーブルに紐づいたサブネット
   * @param destinationCidrBlock 遷移先CIDRブロック
   * @param tgw Transit Gateway
   */
  private addRoute(
    logicalId: string,
    srcSubnet: ec2.SelectedSubnets,
    destinationCidrBlock: string,
    tgw: ec2.CfnTransitGateway
  ) {
    const instanceSubnet = srcSubnet.subnets[0];
    return new ec2.CfnRoute(this, logicalId, {
      destinationCidrBlock,
      routeTableId: instanceSubnet.routeTable.routeTableId,
      transitGatewayId: tgw.attrId,
    });
  }
}
