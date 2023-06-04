import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { RegionBStack } from "./region-b-stack";

export class RegionAStack extends cdk.Stack {
  public readonly tgw: ec2.CfnTransitGateway;
  public static readonly CIDR = "10.0.0.0/16";
  public static readonly PRIVATE_IP = "10.0.0.10";
  private static readonly ISOLATED_CIDR_MASK = 24;
  private static readonly TGW_CIDR_MASK = 28;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPCを作成
    const vpc = this.createVpc("Vpc", RegionAStack.CIDR);

    // サブネットを抽出
    const tgwSubnet = this.selectSubnet(vpc, RegionAStack.TGW_CIDR_MASK);
    const isolatedSubnet = this.selectSubnet(
      vpc,
      RegionAStack.ISOLATED_CIDR_MASK
    );

    // セキュリティグループを作成
    const sg = this.createSg("Sg", vpc);

    // EC2インスタンスを作成
    const instance = this.createInstance(
      "Instance",
      vpc,
      sg,
      RegionAStack.PRIVATE_IP
    );

    /*-------------------*
     * 疎通設定
     *-------------------*/
    // Transit Gatewayを作成
    const tgw = new ec2.CfnTransitGateway(this, "Tgw", {
      amazonSideAsn: 64512,
    });
    this.tgw = tgw;

    // Transit Gateway アタッチメントを作成
    const tgwAttachment = this.createTgwAttachment(
      "TgwAttachment",
      tgwSubnet,
      tgw,
      vpc
    );

    // VPCルートテーブルにTransit Gatewayへのルートを追加
    const route = this.addRoute(
      "One2TwoRoute",
      isolatedSubnet,
      RegionBStack.CIDR,
      tgw
    );
    route.addDependsOn(tgwAttachment);
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
    const vpc = new ec2.Vpc(this, logicalId, {
      ipAddresses: ec2.IpAddresses.cidr(cidr),
      maxAzs: 1,
      subnetConfiguration: [
        {
          name: "Isolated",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: RegionAStack.ISOLATED_CIDR_MASK,
        },
        {
          name: "Tgw",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: RegionAStack.TGW_CIDR_MASK,
        },
      ],
    });
    vpc.addInterfaceEndpoint("VpceSsm", {
      service: ec2.InterfaceVpcEndpointAwsService.SSM,
    });
    vpc.addInterfaceEndpoint("VpceSsmMessages", {
      service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
    });
    vpc.addInterfaceEndpoint("Vpce-Ec2Meaages", {
      service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
    });
    vpc.addGatewayEndpoint("Vpce-S3", {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });
    return vpc;
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
   * @param privateIp プライベートIP
   * @returns
   */
  private createInstance(
    logicalId: string,
    vpc: ec2.Vpc,
    securityGroup: ec2.SecurityGroup,
    privateIp: string
  ) {
    const role = new iam.Role(this, `${logicalId}Role`, {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore"
        ),
      ],
    });
    return new ec2.Instance(this, logicalId, {
      vpc,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T2,
        ec2.InstanceSize.MICRO
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux(),
      securityGroup,
      role,
      privateIpAddress: privateIp,
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
