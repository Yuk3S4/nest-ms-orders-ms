import { OrderStatus } from "@prisma/client"
import { IsEnum, IsUUID } from "class-validator"
import { OrderStatusList } from "../enum/order.enum"

export class ChangeOrderStatusDto {

    @IsUUID(4) // 4 = v4
    id: string

    @IsEnum( OrderStatusList, {
        message: `Valid status are ${ OrderStatusList }`
    })
    status: OrderStatus

}