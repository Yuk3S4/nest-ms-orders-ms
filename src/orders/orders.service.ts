import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CreateOrderDto } from './dto/create-order.dto';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { OrderPaginationDto } from './dto/order-pagination.dto';
import { ChangeOrderStatusDto } from './dto';
import { NATS_SERVICE, PRODUCT_SERVICE } from 'src/config/services';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {

  private readonly _logger = new Logger('OrdersService')
  
  constructor(
    @Inject(NATS_SERVICE) private readonly _client: ClientProxy,
  ) {
    super();
  }

  async onModuleInit() {
    await this.$connect();
    this._logger.log('Database connected')
  }


  async create(createOrderDto: CreateOrderDto) {

    try {

      // 1 Confirmar los ids de los products
      const productIds = createOrderDto.items.map( item => item.productId )
      const products: any[] = await firstValueFrom(
        this._client.send({ cmd: 'validate_products' }, productIds)
      )

      // 2. Cálculos de los valores
      const totalAmount = createOrderDto.items.reduce( (acc, orderItem) => {

        const price = products.find( product => product.id === orderItem.productId ).price

        return  acc + price * orderItem.quantity
      }, 0)

      const totalItems = createOrderDto.items.reduce( (acc, orderItem) => {
        return acc + orderItem.quantity
      }, 0)

      // 3. Transación de base de datos
      const order = await this.order.create({
        data: {
          totalAmount,
          totalItems,
          OrderItem: {
            createMany: {
              data: createOrderDto.items.map( orderItem => ({
                price: products.find( 
                  product => product.id === orderItem.productId 
                ).price,
                productId: orderItem.productId,
                quantity: orderItem.quantity,
              }))
            }
          }
        },
        include: {
          OrderItem: {
            select: {
              price: true,
              quantity: true,
              productId: true,
            }
          }
        }
      })

      return {
        ...order,
        OrderItem: order.OrderItem.map( orderItem => ({
          ...orderItem,
          name: products.find( 
            product => product.id === orderItem.productId 
          ).name
        }))
      }

    } catch (error) {

      throw new RpcException({
        status: HttpStatus.BAD_REQUEST,
        message: 'Check logs'
      })

    }

  }

  async findAll( orderPaginationDto: OrderPaginationDto ) {

    const totalPages = await this.order.count({
      where: {
        status: orderPaginationDto.status
      }
    })

    const currentPage = orderPaginationDto.page ?? 1
    const perPage = orderPaginationDto.limit ?? 10

    return {
      data: await this.order.findMany({
        skip: (currentPage - 1) * perPage,
        take: perPage,
        where: {
          status: orderPaginationDto.status
        }
      }),
      meta: {
        total: totalPages,
        page: currentPage,
        lastPage: Math.ceil( totalPages / perPage )
      }
    }
  }

  async findOne(id: string) {
    const order = await this.order.findFirst({
      where: { id },
      include: {
        OrderItem: {
          select: {
            price: true,
            quantity: true,
            productId: true,
          }
        }
      }
    });

    if (!order) {
      throw new RpcException({
        message: `Order with id #${ id } not found`,
        status: HttpStatus.NOT_FOUND
      })
    }

    const productIds = order.OrderItem.map( orderItem => orderItem.productId )
    const products: any[] = await firstValueFrom(
      this._client.send({ cmd: 'validate_products' }, productIds)
    )

    return {
      ...order,
      OrderItem: order.OrderItem.map( orderItem => ({
        ...orderItem,
        name: products.find( 
          product => product.id === orderItem.productId 
        ).name
      }))
    }
  
  }

  async changeStatus( changeOrderStatusDto: ChangeOrderStatusDto ) {

    const { id, status } = changeOrderStatusDto 

    const order = await this.findOne(id)
    if ( order.status === status ) return order // Eficiencia del código

    return this.order.update({
      where: { id },
      data: { status },
    })
  }
  
}
